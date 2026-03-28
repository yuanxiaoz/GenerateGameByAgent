from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from tortoise import Tortoise

from .config import get_settings
from .database import build_tortoise_config
from .models import ServerAPIConfig


settings = get_settings()


# ---------------------------------------------------------------------------
# 运行时 API 配置（从数据库加载后缓存于此）
# ---------------------------------------------------------------------------

class _RuntimeAPIConfig:
    """启动时从数据库加载的服务器 API 配置，运行期间只读。"""

    def __init__(self) -> None:
        self.provider: str = "deepseek"
        self.base_url: str = ""
        self.api_key: str = ""
        self.auth_header: str = "Authorization"
        self.auth_scheme: str = "Bearer"
        self.default_model: str = "deepseek-chat"
        self.embedding_model: str = ""
        self.temperature: float = 0.7
        self.max_tokens: int = 8192
        self.timeout_seconds: float = 180.0

    @property
    def has_server_managed_ai(self) -> bool:
        return bool(self.base_url and self.api_key)

    def load_from_db_row(self, row: ServerAPIConfig) -> None:
        self.provider = row.provider
        self.base_url = row.base_url.strip().rstrip("/")
        if self.base_url.endswith("/v1"):
            self.base_url = self.base_url[:-3].rstrip("/")
        self.api_key = row.api_key
        self.auth_header = row.auth_header or "Authorization"
        self.auth_scheme = row.auth_scheme
        self.default_model = row.default_model
        self.embedding_model = row.embedding_model or ""
        self.temperature = row.temperature
        self.max_tokens = row.max_tokens
        self.timeout_seconds = row.timeout_seconds


api_config = _RuntimeAPIConfig()


# ---------------------------------------------------------------------------
# 日志
# ---------------------------------------------------------------------------

def _write_log(proxy_path: str, request_body: bytes, response_body: bytes, status_code: int) -> None:
    if not settings.log_path:
        return
    try:
        log_dir = Path(settings.log_path)
        log_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        log_file = log_dir / f"{ts}_{proxy_path.replace('/', '_')}.json"
        try:
            req = json.loads(request_body) if request_body else None
        except Exception:
            req = request_body.decode("utf-8", errors="replace") if request_body else None
        try:
            resp = json.loads(response_body) if response_body else None
        except Exception:
            resp = response_body.decode("utf-8", errors="replace") if response_body else None
        entry = {
            "time": datetime.now().isoformat(),
            "path": proxy_path,
            "status": status_code,
            "request": req,
            "response": resp,
        }
        log_file.write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[日志写入失败] {e}")


# ---------------------------------------------------------------------------
# FastAPI 应用
# ---------------------------------------------------------------------------

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# ---------------------------------------------------------------------------
# 生命周期：数据库初始化 & 配置加载
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def on_startup() -> None:
    await Tortoise.init(config=build_tortoise_config())
    await Tortoise.generate_schemas(safe=True)
    row = await ServerAPIConfig.filter(is_active=True).first()
    if row:
        api_config.load_from_db_row(row)
        print(f"[启动] 已从数据库加载 API 配置：{row.name}，provider={api_config.provider}")
    else:
        print("[启动] 数据库中没有 is_active=true 的配置，请在 server_api_config 表中设置")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await Tortoise.close_connections()


# ---------------------------------------------------------------------------
# 代理辅助函数
# ---------------------------------------------------------------------------

REQUEST_HOP_HEADERS = {
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}

RESPONSE_HOP_HEADERS = {
    "connection",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


# 各 provider 的路径前缀映射（覆盖前端传来的 proxy_path）
_PROVIDER_PATH_PREFIX: dict[str, str] = {
    "zhipu": "/api/paas/v4",
}
_DEFAULT_PATH_PREFIX = "/v1"


def _normalize_proxy_path(proxy_path: str) -> str:
    """将前端传来的任意 proxy_path 规范化为末尾的端点段（如 chat/completions、embeddings）。"""
    trimmed = proxy_path.strip("/")
    # 去掉可能由前端拼入的 v1/ 或 api/paas/v4/ 等前缀，只保留端点名
    for prefix in ("v1/", "api/paas/v4/"):
        if trimmed.startswith(prefix):
            trimmed = trimmed[len(prefix):]
            break
    return trimmed


def _build_upstream_url(proxy_path: str) -> str:
    endpoint = _normalize_proxy_path(proxy_path)
    if not endpoint:
        raise HTTPException(status_code=404, detail="Missing proxy path.")
    prefix = _PROVIDER_PATH_PREFIX.get(api_config.provider, _DEFAULT_PATH_PREFIX)
    return f"{api_config.base_url}{prefix}/{endpoint}"


def _build_upstream_headers(request: Request) -> dict[str, str]:
    headers: dict[str, str] = {}
    for key, value in request.headers.items():
        lower = key.lower()
        if lower in REQUEST_HOP_HEADERS or lower == "authorization":
            continue
        if lower.startswith("x-forwarded-"):
            continue
        headers[key] = value

    auth_header = api_config.auth_header
    if auth_header.lower() == "authorization":
        scheme = f"{api_config.auth_scheme.strip()} " if api_config.auth_scheme.strip() else ""
        headers[auth_header] = f"{scheme}{api_config.api_key}".strip()
    else:
        headers[auth_header] = api_config.api_key
    return headers


def _filter_response_headers(headers: httpx.Headers) -> dict[str, str]:
    filtered: dict[str, str] = {}
    for key, value in headers.items():
        if key.lower() in RESPONSE_HOP_HEADERS:
            continue
        filtered[key] = value
    return filtered


def _inject_defaults_if_needed(proxy_path: str, request: Request, body: bytes) -> bytes:
    """
    对 chat/completions 和 embeddings 请求注入缺失的默认参数：
    - model（模型名）
    - temperature（温度，仅 chat）
    - max_tokens（最大 token 数，仅 chat）
    """
    if not body:
        return body

    content_type = request.headers.get("content-type", "").lower()
    if "application/json" not in content_type:
        return body

    try:
        payload = json.loads(body)
    except Exception:
        return body

    if not isinstance(payload, dict):
        return body

    trimmed_path = proxy_path.strip("/")
    changed = False

    if trimmed_path.endswith("chat/completions"):
        if api_config.default_model:
            payload["model"] = api_config.default_model
            changed = True
        if "temperature" not in payload:
            payload["temperature"] = api_config.temperature
            changed = True
        if "max_tokens" not in payload:
            payload["max_tokens"] = api_config.max_tokens
            changed = True

    if trimmed_path.endswith("embeddings"):
        if api_config.embedding_model:
            payload["model"] = api_config.embedding_model
            changed = True

    if not changed:
        return body

    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _should_stream(request: Request, body: bytes) -> bool:
    if request.method.upper() != "POST" or not body:
        return False

    content_type = request.headers.get("content-type", "").lower()
    if "application/json" not in content_type:
        return False

    try:
        payload = json.loads(body)
    except Exception:
        return False

    return isinstance(payload, dict) and payload.get("stream") is True


async def _stream_response(
    upstream_response: httpx.Response,
    client: httpx.AsyncClient,
    proxy_path: str,
    request_body: bytes,
) -> AsyncIterator[bytes]:
    collected: list[bytes] = []
    try:
        async for chunk in upstream_response.aiter_bytes():
            collected.append(chunk)
            yield chunk
    finally:
        await client.aclose()
        full_response = b"".join(collected)
        _write_log(proxy_path, request_body, full_response, upstream_response.status_code)


# ---------------------------------------------------------------------------
# 版本 & 状态接口
# ---------------------------------------------------------------------------

@app.get("/api/v1/version")
async def version() -> dict:
    return {
        "version": settings.app_version,
        "server_managed_ai": api_config.has_server_managed_ai,
        "cloud_enabled": False,
        "capabilities": {
            "ai_proxy": api_config.has_server_managed_ai,
            "cloud": False,
        },
    }


@app.get("/api/v1/ai-proxy/status")
async def ai_proxy_status() -> dict:
    return {
        "configured": api_config.has_server_managed_ai,
        "provider": api_config.provider,
        "base_url": api_config.base_url,
        "default_model": api_config.default_model,
        "embedding_model": api_config.embedding_model or None,
        "temperature": api_config.temperature,
        "max_tokens": api_config.max_tokens,
    }


# ---------------------------------------------------------------------------
# AI 代理路由
# ---------------------------------------------------------------------------

@app.api_route(
    "/api/v1/ai-proxy/{proxy_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def ai_proxy(proxy_path: str, request: Request):
    row = await ServerAPIConfig.filter(is_active=True).first()
    if not row:
        raise HTTPException(
            status_code=503,
            detail="Server-managed AI is not configured. Please set is_active=true in server_api_config.",
        )
    api_config.load_from_db_row(row)

    body = await request.body()
    body = _inject_defaults_if_needed(proxy_path, request, body)
    upstream_url = _build_upstream_url(proxy_path)
    headers = _build_upstream_headers(request)
    params = dict(request.query_params)

    if _should_stream(request, body):
        client = httpx.AsyncClient(timeout=api_config.timeout_seconds)
        upstream_response = await client.send(
            client.build_request(
                method=request.method,
                url=upstream_url,
                headers=headers,
                params=params,
                content=body,
            ),
            stream=True,
        )
        return StreamingResponse(
            _stream_response(upstream_response, client, proxy_path, body),
            status_code=upstream_response.status_code,
            headers=_filter_response_headers(upstream_response.headers),
            media_type=upstream_response.headers.get("content-type"),
        )

    async with httpx.AsyncClient(timeout=api_config.timeout_seconds) as client:
        upstream_response = await client.request(
            method=request.method,
            url=upstream_url,
            headers=headers,
            params=params,
            content=body,
        )

    _write_log(proxy_path, body, upstream_response.content, upstream_response.status_code)
    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=_filter_response_headers(upstream_response.headers),
        media_type=upstream_response.headers.get("content-type"),
    )


@app.exception_handler(httpx.HTTPError)
async def httpx_exception_handler(_: Request, exc: httpx.HTTPError):
    return JSONResponse(
        status_code=502,
        content={"detail": f"AI upstream request failed: {exc}"},
    )
