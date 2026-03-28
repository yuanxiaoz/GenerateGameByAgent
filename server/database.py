from __future__ import annotations

from .config import get_settings


def build_tortoise_config() -> dict:
    """
    根据 settings.database_url 构建 Tortoise-ORM 配置。
    支持 PostgreSQL（asyncpg）和 SQLite（aiosqlite，仅用于本地开发）。
    """
    settings = get_settings()
    db_url = settings.database_url or "sqlite://server/app.db"
    # tortoise-orm 要求 PostgreSQL 使用 asyncpg:// scheme
    if db_url.startswith("postgresql://"):
        db_url = "asyncpg://" + db_url[len("postgresql://"):]
    elif db_url.startswith("postgresql+asyncpg://"):
        db_url = "asyncpg://" + db_url[len("postgresql+asyncpg://"):]

    return {
        "connections": {
            "default": db_url,
        },
        "apps": {
            "models": {
                "models": ["server.models"],
                "default_connection": "default",
            }
        },
    }


# aerich 迁移工具读取此变量
TORTOISE_ORM = build_tortoise_config()
