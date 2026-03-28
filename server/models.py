from __future__ import annotations

from tortoise import fields
from tortoise.models import Model


class ServerAPIConfig(Model):
    """
    服务器端 AI 接口配置表。
    支持配置多个上游供应商，通过 is_active 字段标记当前使用哪一个。
    切换供应商时：把目标行的 is_active 改为 true，其他行改为 false，重启服务即生效。
    """

    id = fields.IntField(pk=True, description="主键，自增")

    # ---- 标识 ----
    name = fields.CharField(
        max_length=128,
        description="供应商备注名称，便于识别，如 DeepSeek主力 / OpenAI备用",
    )
    is_active = fields.BooleanField(
        default=False,
        description="是否为当前激活的供应商；启动时加载 is_active=true 的第一条记录",
    )

    # ---- 接入点 ----
    provider = fields.CharField(
        max_length=64,
        default="deepseek",
        description="上游提供商标识，如 deepseek / openai / custom",
    )
    base_url = fields.CharField(
        max_length=512,
        description="上游 API 根地址，不含末尾 /v1，例如 https://api.deepseek.com",
    )
    api_key = fields.CharField(
        max_length=512,
        description="上游 API 密钥（SK）",
    )
    auth_header = fields.CharField(
        max_length=128,
        default="Authorization",
        description="鉴权请求头名称，通常为 Authorization",
    )
    auth_scheme = fields.CharField(
        max_length=64,
        default="Bearer",
        description="鉴权方案前缀，通常为 Bearer；留空则直接发送裸 key",
    )

    # ---- 模型 ----
    default_model = fields.CharField(
        max_length=256,
        default="deepseek-chat",
        description="默认聊天模型名称，用于 chat/completions 请求",
    )
    embedding_model = fields.CharField(
        max_length=256,
        default="",
        description="默认嵌入模型名称，用于 embeddings 请求；留空则不注入",
    )

    # ---- 生成参数 ----
    temperature = fields.FloatField(
        default=0.7,
        description="生成温度，范围 0.0～2.0，值越高输出越随机",
    )
    max_tokens = fields.IntField(
        default=8192,
        description="单次请求最大生成 token 数",
    )

    # ---- 超时 ----
    timeout_seconds = fields.FloatField(
        default=180.0,
        description="上游请求超时时间（秒）",
    )

    class Meta:
        table = "server_api_config"
        table_description = "服务器端 AI 接口配置，支持多供应商，is_active=true 的为当前使用项"
