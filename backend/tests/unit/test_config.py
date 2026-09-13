# 環境変数からの設定の読み込み（design.md 2.3、6.3、7.2）。test_spec.md にケース ID がないため test_extra_
import pytest

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


def test_extra_app_env_unset_is_not_production():
    # 業務用 Clock（段階1）と同じく、production 以外は開発扱い
    env = {k: v for k, v in BASE_ENV.items() if k != "APP_ENV"}
    settings = load_settings(env)
    assert settings.app_env == "development"
    assert settings.is_production is False


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
