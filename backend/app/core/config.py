"""環境変数からの設定（design.md 2.3、6.3、7）。秘密情報はコードに持たない（NFR-SEC-10）。"""

import os
from collections.abc import Mapping
from dataclasses import dataclass

PRODUCTION = "production"
DEFAULT_APP_ENV = "development"
DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 3600


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    app_env: str
    database_url: str
    jwt_secret_key: str
    access_token_ttl_seconds: int
    cors_allow_origins: tuple[str, ...]

    @property
    def is_production(self) -> bool:
        return self.app_env == PRODUCTION


def _required(env: Mapping[str, str], key: str) -> str:
    value = env.get(key)
    if not value:
        raise ConfigError(f"{key} is required")
    return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    app_env = env.get("APP_ENV") or DEFAULT_APP_ENV

    # テスト用の環境変数は本番では無視する（design.md 6.3）
    access_token_ttl_seconds = DEFAULT_ACCESS_TOKEN_TTL_SECONDS
    if app_env != PRODUCTION and env.get("ACCESS_TOKEN_TTL_SECONDS"):
        access_token_ttl_seconds = int(env["ACCESS_TOKEN_TTL_SECONDS"])

    cors_allow_origins = tuple(
        origin.strip() for origin in env.get("CORS_ALLOW_ORIGINS", "").split(",") if origin.strip()
    )
    return Settings(
        app_env=app_env,
        database_url=_required(env, "DATABASE_URL"),
        jwt_secret_key=_required(env, "JWT_SECRET_KEY"),
        access_token_ttl_seconds=access_token_ttl_seconds,
        cors_allow_origins=cors_allow_origins,
    )
