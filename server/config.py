from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional dependency during static checks
    load_dotenv = None


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DOTENV_PATH = PROJECT_ROOT / "server" / ".env"

if load_dotenv and DOTENV_PATH.exists():
    load_dotenv(DOTENV_PATH)


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str) -> list[str]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return []
    if raw == "*":
        return ["*"]
    return [item.strip() for item in raw.split(",") if item.strip()]


def _read_package_version() -> str:
    package_json = PROJECT_ROOT / "package.json"
    try:
        data = json.loads(package_json.read_text(encoding="utf-8"))
        return str(data.get("version") or "dev")
    except Exception:
        return "dev"


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_version: str
    cors_origins: list[str]
    debug: bool
    log_path: str
    database_url: str  # PostgreSQL 连接字符串，例如 postgresql://user:pass@host:5432/dbname


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        app_name=os.getenv("APP_NAME", "XianTu Backend"),
        app_version=os.getenv("APP_VERSION", _read_package_version()),
        cors_origins=_env_list("CORS_ALLOWED_ORIGINS"),
        debug=_env_bool("DEBUG", False),
        log_path=os.getenv("AI_LOG_PATH", "").strip(),
        database_url=os.getenv("DATABASE_URL", "").strip(),
    )
