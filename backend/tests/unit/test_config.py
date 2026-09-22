# 環境変数からの設定の読み込み（design.md 2.3、6.3、7.2）。test_spec.md にケース ID がないため test_extra_
from pathlib import Path

import pytest

from app.core import config
from app.core.config import ConfigError, load_settings

BASE_ENV = {
    "APP_ENV": "development",
    "DATABASE_URL": "mysql+pymysql://pos_app:secret@mysql:3306/pos",
    "JWT_SECRET_KEY": "unit-test-secret-key-0123456789-abcdef",
    "ACCESS_TOKEN_TTL_SECONDS": "5",
    "CORS_ALLOW_ORIGINS": "http://frontend:3000, http://localhost:3000",
}


def test_extra_loads_all_values_in_development():
    settings = load_settings(BASE_ENV)
    assert settings.app_env == "development"
    assert settings.is_production is False
    assert settings.database_url == "mysql+pymysql://pos_app:secret@mysql:3306/pos"
    assert settings.jwt_secret_key == "unit-test-secret-key-0123456789-abcdef"
    assert settings.access_token_ttl_seconds == 5
    assert settings.cors_allow_origins == ("http://frontend:3000", "http://localhost:3000")


def test_extra_production_ignores_access_token_ttl():
    # design.md 6.3：APP_ENV=production ではテスト用の環境変数を無視する
    settings = load_settings({**BASE_ENV, "APP_ENV": "production"})
    assert settings.is_production is True
    assert settings.access_token_ttl_seconds == 3600


@pytest.mark.parametrize("ttl", [None, ""])
def test_extra_access_token_ttl_defaults_to_3600(ttl):
    env = {k: v for k, v in BASE_ENV.items() if k != "ACCESS_TOKEN_TTL_SECONDS"}
    if ttl is not None:
        env["ACCESS_TOKEN_TTL_SECONDS"] = ttl
    assert load_settings(env).access_token_ttl_seconds == 3600


@pytest.mark.parametrize("app_env", [None, ""])
def test_extra_app_env_unset_is_production(app_env):
    # 人間が決定：APP_ENV が未設定・空なら本番扱い（docs 無効、テスト用の環境変数を無視）。業務用 Clock と同じ判定
    env = {k: v for k, v in BASE_ENV.items() if k != "APP_ENV"}
    if app_env is not None:
        env["APP_ENV"] = app_env
    settings = load_settings(env)
    assert settings.app_env == "production"
    assert settings.is_production is True
    assert settings.access_token_ttl_seconds == 3600


@pytest.mark.parametrize("missing", ["DATABASE_URL", "JWT_SECRET_KEY"])
def test_extra_required_values_raise_when_missing(missing):
    env = {k: v for k, v in BASE_ENV.items() if k != missing}
    with pytest.raises(ConfigError):
        load_settings(env)


def test_extra_cors_allow_origins_unset_is_empty():
    env = {k: v for k, v in BASE_ENV.items() if k != "CORS_ALLOW_ORIGINS"}
    assert load_settings(env).cors_allow_origins == ()


def test_extra_reads_os_environ_by_default(monkeypatch):
    for key, value in BASE_ENV.items():
        monkeypatch.setenv(key, value)
    assert load_settings().access_token_ttl_seconds == 5


# --- Azure の共有 MySQL への接続（DB_PASSWORD を URL に埋め込まない） ---
# パスワードに特殊文字が含まれうるため、DATABASE_URL に直接書かず、部品から組み立てて URL エンコードする

AZURE_ENV = {
    "APP_ENV": "development",
    "JWT_SECRET_KEY": "unit-test-secret-key-0123456789-abcdef",
    "DB_HOST": "gen12-mysql-pos.mysql.database.azure.com",
    "DB_PORT": "3306",
    "DB_NAME": "pos_oguchan",
    "DB_USER": "tech0",
    "DB_PASSWORD": "p@ss w/rd#1+2%3&4?5=6:7",
}


def test_extra_builds_database_url_from_parts_with_url_encoding():
    settings = load_settings(AZURE_ENV)
    assert settings.database_url == (
        "mysql+pymysql://tech0:p%40ss+w%2Frd%231%2B2%253%264%3F5%3D6%3A7"
        "@gen12-mysql-pos.mysql.database.azure.com:3306/pos_oguchan"
    )


def test_extra_builds_database_url_encodes_user_too():
    settings = load_settings({**AZURE_ENV, "DB_USER": "tech0@gen12-mysql-pos"})
    assert settings.database_url.startswith("mysql+pymysql://tech0%40gen12-mysql-pos:")


def test_extra_db_port_defaults_to_3306():
    env = {k: v for k, v in AZURE_ENV.items() if k != "DB_PORT"}
    assert load_settings(env).database_url.endswith(":3306/pos_oguchan")


@pytest.mark.parametrize("missing", ["DB_HOST", "DB_NAME", "DB_USER"])
def test_extra_db_parts_are_required_when_db_password_is_set(missing):
    env = {k: v for k, v in AZURE_ENV.items() if k != missing}
    with pytest.raises(ConfigError):
        load_settings(env)


@pytest.mark.parametrize("password", [None, ""])
def test_extra_database_url_is_used_when_db_password_is_absent(password):
    env = dict(BASE_ENV)
    if password is not None:
        env["DB_PASSWORD"] = password
    assert load_settings(env).database_url == BASE_ENV["DATABASE_URL"]


def test_extra_db_ssl_ca_is_none_by_default():
    assert load_settings(BASE_ENV).db_ssl_ca is None


def test_extra_db_ssl_ca_keeps_the_given_path():
    settings = load_settings({**AZURE_ENV, "DB_SSL_CA": "/etc/ssl/certs/ca-certificates.crt"})
    assert settings.db_ssl_ca == "/etc/ssl/certs/ca-certificates.crt"


def test_extra_db_ssl_ca_system_resolves_to_the_os_bundle():
    # Azure は require_secure_transport=ON。system と書いたら OS の CA を使って証明書を検証する
    settings = load_settings({**AZURE_ENV, "DB_SSL_CA": "system"})
    assert settings.db_ssl_ca is not None
    assert Path(settings.db_ssl_ca).exists()


def test_extra_db_ssl_ca_system_raises_when_the_os_bundle_is_unknown(monkeypatch):
    monkeypatch.setattr(config, "_default_ca_file", lambda: None)
    with pytest.raises(ConfigError):
        load_settings({**AZURE_ENV, "DB_SSL_CA": "system"})
