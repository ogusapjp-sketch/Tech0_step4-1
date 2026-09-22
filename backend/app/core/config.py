"""環境変数からの設定（design.md 2.3、6.3、7）。秘密情報はコードに持たない（NFR-SEC-10）。"""

import os
import ssl
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import quote_plus

PRODUCTION = "production"
DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 3600
DEFAULT_DB_PORT = "3306"
# DB_SSL_CA にこの値を書いたら、OS が持つ CA（証明書ストア）で サーバ証明書を検証する
SYSTEM_CA = "system"


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    app_env: str
    database_url: str
    jwt_secret_key: str
    access_token_ttl_seconds: int
    cors_allow_origins: tuple[str, ...]
    db_ssl_ca: str | None = None

    @property
    def is_production(self) -> bool:
        return self.app_env == PRODUCTION


def _required(env: Mapping[str, str], key: str) -> str:
    value = env.get(key)
    if not value:
        raise ConfigError(f"{key} is required")
    return value


def _default_ca_file() -> str | None:
    """OS の CA ファイルの場所。テストで差し替えられるよう関数にする。"""
    return ssl.get_default_verify_paths().cafile


def _build_database_url(env: Mapping[str, str]) -> str:
    """接続文字列を組み立てる。

    パスワードに `@` `:` `/` `#` などが含まれても壊れないよう、DATABASE_URL には埋め込まず、
    DB_PASSWORD から読んで URL エンコードする（Azure の共有 MySQL）。
    DB_PASSWORD がなければ、これまでどおり DATABASE_URL をそのまま使う（ローカルの Docker）。
    """
    password = env.get("DB_PASSWORD")
    if not password:
        return _required(env, "DATABASE_URL")
    user = quote_plus(_required(env, "DB_USER"))
    host = _required(env, "DB_HOST")
    database = _required(env, "DB_NAME")
    port = env.get("DB_PORT") or DEFAULT_DB_PORT
    return f"mysql+pymysql://{user}:{quote_plus(password)}@{host}:{port}/{database}"


def resolve_db_ssl_ca(value: str | None) -> str | None:
    """SSL に使う CA ファイルの場所。未設定なら SSL を使わない（ローカルの Docker）。"""
    if not value:
        return None
    if value != SYSTEM_CA:
        return value
    ca_file = _default_ca_file()
    if not ca_file:
        raise ConfigError("DB_SSL_CA=system ですが、OS の CA ファイルが見つかりません")
    return ca_file


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    # 未設定・空なら本番扱い。設定漏れのときに安全側（docs 無効、テスト用の環境変数を無視）に倒す
    app_env = env.get("APP_ENV") or PRODUCTION

    # テスト用の環境変数は本番では無視する（design.md 6.3）
    access_token_ttl_seconds = DEFAULT_ACCESS_TOKEN_TTL_SECONDS
    if app_env != PRODUCTION and env.get("ACCESS_TOKEN_TTL_SECONDS"):
        access_token_ttl_seconds = int(env["ACCESS_TOKEN_TTL_SECONDS"])

    cors_allow_origins = tuple(
        origin.strip() for origin in env.get("CORS_ALLOW_ORIGINS", "").split(",") if origin.strip()
    )
    return Settings(
        app_env=app_env,
        database_url=_build_database_url(env),
        jwt_secret_key=_required(env, "JWT_SECRET_KEY"),
        access_token_ttl_seconds=access_token_ttl_seconds,
        cors_allow_origins=cors_allow_origins,
        db_ssl_ca=resolve_db_ssl_ca(env.get("DB_SSL_CA")),
    )
