# FastAPI アプリの土台：docs の切り替え（design.md 7.4）、CORS（7.2）、エラー応答（6.2）、認証の依存関数（7.1）
# test_spec.md にケース ID がないため test_extra_
from datetime import datetime
from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.core.clock import FixedClock
from app.core.config import Settings
from app.core.errors import api_error
from app.core.security import create_access_token
from app.dependencies import get_current_staff_id
from app.main import create_app
from app.schemas import LoginRequest
from app.services.pricing import Totals

SECRET = "unit-test-secret-key-0123456789-abcdef"
ISSUED_AT = datetime(2026, 9, 5, 12, 0, 0)


def make_settings(app_env: str = "development") -> Settings:
    return Settings(
        app_env=app_env,
        database_url="mysql+pymysql://pos_app:secret@127.0.0.1:3306/pos",
        jwt_secret_key=SECRET,
        access_token_ttl_seconds=3600,
        cors_allow_origins=("http://frontend:3000",),
    )


def make_client(app_env: str = "development", token_now: datetime = ISSUED_AT) -> TestClient:
    app = create_app(
        make_settings(app_env),
        business_clock=FixedClock(ISSUED_AT),
        token_clock=FixedClock(token_now),
    )

    @app.get("/_test/me")
    def me(staff_id: Annotated[str, Depends(get_current_staff_id)]) -> dict:
        return {"staff_id": staff_id}

    @app.post("/_test/login")
    def login(body: LoginRequest) -> dict:
        return {"staff_id": body.staff_id}

    @app.get("/_test/product-not-found")
    def product_not_found() -> dict:
        raise api_error("PRODUCT_NOT_FOUND")

    @app.get("/_test/totals-mismatch")
    def totals_mismatch() -> dict:
        raise api_error("TOTALS_MISMATCH", server_totals=Totals(2915, 145, 277, 3047))

    @app.get("/_test/duplicate")
    def duplicate() -> dict:
        raise api_error("DUPLICATE", transaction_id=12)

    @app.get("/_test/boom")
    def boom() -> dict:
        raise RuntimeError("SELECT * FROM staff -- secret detail")

    return TestClient(app, raise_server_exceptions=False)


# --- Swagger Docs（design.md 7.4、ST-39 と同じ条件） ---------------------------

@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_extra_docs_enabled_in_development(path):
    assert make_client("development").get(path).status_code == 200


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_extra_docs_disabled_in_production(path):
    assert make_client("production").get(path).status_code == 404


# --- CORS（design.md 7.2） -----------------------------------------------------

def test_extra_cors_allows_configured_origin_only():
    client = make_client()
    headers = {"Access-Control-Request-Method": "GET"}
    allowed = client.options("/_test/me", headers={**headers, "Origin": "http://frontend:3000"})
    denied = client.options("/_test/me", headers={**headers, "Origin": "http://evil.example"})
    assert allowed.headers.get("access-control-allow-origin") == "http://frontend:3000"
    assert "access-control-allow-origin" not in denied.headers


# --- エラー応答（design.md 5.2 ErrorResponse、6.2） ------------------------------

def test_extra_api_error_response_shape():
    response = make_client().get("/_test/product-not-found")
    assert response.status_code == 404
    assert response.json() == {"code": "PRODUCT_NOT_FOUND", "message": "商品がマスタ未登録です"}


def test_extra_totals_mismatch_includes_server_totals():
    response = make_client().get("/_test/totals-mismatch")
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "TOTALS_MISMATCH"
    assert body["details"] == {
        "server_totals": {"subtotal": 2915, "discount_total": 145, "tax_amount": 277, "total": 3047}
    }


def test_extra_duplicate_includes_transaction_id():
    response = make_client().get("/_test/duplicate")
    assert response.status_code == 409
    assert response.json()["details"] == {"transaction_id": 12}


@pytest.mark.parametrize("kwargs", [
    pytest.param({"json": {"staff_id": "S001", "password": "ramen-owner-2026", "unknown": 1}}, id="unknown-field"),
    pytest.param({"json": {"staff_id": "S 001", "password": "ramen-owner-2026"}}, id="invalid-value"),
    pytest.param({"content": b"{not json", "headers": {"Content-Type": "application/json"}}, id="broken-json"),
])
def test_extra_validation_error_is_400(kwargs):
    response = make_client().post("/_test/login", **kwargs)
    assert response.status_code == 400
    assert response.json() == {"code": "VALIDATION_ERROR", "message": "入力値が不正です"}


def test_extra_unexpected_exception_is_500_without_details():
    response = make_client().get("/_test/boom")
    assert response.status_code == 500
    assert response.json() == {"code": "INTERNAL_ERROR", "message": "処理に失敗しました。もう一度お試しください"}
    assert "SELECT" not in response.text and "Traceback" not in response.text


# --- 認証の依存関数（design.md 5.1 BFF の共通処理、6.2） --------------------------

def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_extra_valid_access_token_passes():
    token = create_access_token("S001", ISSUED_AT, SECRET, 3600)
    response = make_client().get("/_test/me", headers=bearer(token))
    assert response.status_code == 200
    assert response.json() == {"staff_id": "S001"}


@pytest.mark.parametrize("headers", [
    pytest.param({}, id="no-header"),
    pytest.param({"Authorization": "Basic dXNlcjpwYXNz"}, id="not-bearer"),
    pytest.param({"Authorization": "Bearer "}, id="empty-token"),
    pytest.param({"Authorization": "Bearer abc"}, id="malformed"),
])
def test_extra_missing_or_invalid_token_is_token_invalid(headers):
    response = make_client().get("/_test/me", headers=headers)
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"


def test_extra_expired_access_token_is_token_expired():
    token = create_access_token("S001", ISSUED_AT, SECRET, 3600)
    client = make_client(token_now=datetime(2026, 9, 5, 13, 0, 0))
    response = client.get("/_test/me", headers=bearer(token))
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_EXPIRED"


def test_extra_app_state_holds_injected_dependencies():
    settings = make_settings()
    business_clock = FixedClock(ISSUED_AT)
    app = create_app(settings, business_clock=business_clock, token_clock=FixedClock(ISSUED_AT))
    assert app.state.settings is settings
    assert app.state.business_clock is business_clock
