# API ルータ（design.md 5.1・5.2、6.2）。DB は使わず、インメモリの偽リポジトリを注入した TestClient で確認する
# test_spec.md 4.1 にケース ID がないため test_extra_。期待値は IT-nn・ST-nn・UT-B の表の値を使う
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.core.clock import FixedClock
from app.core.config import Settings
from app.main import create_app
from tests.unit.fakes import PASSWORDS, provider_for, seed_repositories

SECRET = "unit-test-secret-key-0123456789-abcdef"
BASE_NOW = datetime(2026, 9, 5, 12, 0, 0)  # テスト基準日 9/5（企画1〜3・5 が有効）
KEY_1 = "3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f"
KEY_2 = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"


def make_client(business_now: datetime = BASE_NOW):
    repositories = seed_repositories()
    app = create_app(
        Settings(
            app_env="development",
            database_url="mysql+pymysql://pos_app:secret@127.0.0.1:3306/pos",
            jwt_secret_key=SECRET,
            access_token_ttl_seconds=3600,
            cors_allow_origins=(),
        ),
        business_clock=FixedClock(business_now),
        token_clock=FixedClock(BASE_NOW),
        repositories_provider=provider_for(repositories),
    )
    return TestClient(app, raise_server_exceptions=False), repositories


def login(client: TestClient, staff_id: str = "S001") -> dict:
    response = client.post("/auth/login", json={"staff_id": staff_id, "password": PASSWORDS[staff_id]})
    assert response.status_code == 200
    return response.json()


def auth(client: TestClient, staff_id: str = "S001") -> dict:
    return {"Authorization": f"Bearer {login(client, staff_id)['access_token']}"}


def transaction_body(key=KEY_1, member_id="M000001", items=None, totals=(2915, 145, 277, 3047), **extra) -> dict:
    # 既定は UT-B-19・IT-14 の明細
    subtotal, discount_total, tax_amount, total = totals
    return {
        "idempotency_key": key,
        "member_id": member_id,
        "items": items if items is not None else [
            {"product_code": "1001", "quantity": 2},
            {"product_code": "2001", "quantity": 3},
            {"product_code": "1004", "quantity": 1},
        ],
        "client_totals": {"subtotal": subtotal, "discount_total": discount_total, "tax_amount": tax_amount, "total": total},
        **extra,
    }


def assert_error(response, status: int, code: str) -> dict:
    assert response.status_code == status
    body = response.json()
    assert body["code"] == code
    assert "Traceback" not in response.text
    return body


# ===========================================================================
# 7つの API の正常系
# ===========================================================================

def test_extra_api1_login():
    client, _ = make_client()
    response = client.post("/auth/login", json={"staff_id": "S001", "password": "ramen-owner-2026"})
    assert response.status_code == 200
    body = response.json()
    # FastAPI → BFF の内部応答（人間が決定）：トークンと担当者
    assert set(body) == {"access_token", "refresh_token", "staff_id", "name"}
    assert body["staff_id"] == "S001"
    assert body["name"] == "店主"


def test_extra_api2_refresh():
    client, _ = make_client()
    tokens = login(client)
    response = client.post("/auth/refresh", headers={"Authorization": f"Bearer {tokens['refresh_token']}"})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"access_token", "refresh_token"}
    assert body["refresh_token"] != tokens["refresh_token"]


def test_extra_api3_logout():
    client, _ = make_client()
    tokens = login(client)
    response = client.post(
        "/auth/logout",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert response.status_code == 204
    assert response.content == b""
    # 失効したリフレッシュトークンでは更新できない（ST-36）
    refreshed = client.post("/auth/refresh", headers={"Authorization": f"Bearer {tokens['refresh_token']}"})
    assert_error(refreshed, 401, "TOKEN_INVALID")


def test_extra_api4_settings():
    # IT-07：基準日 9/5 は税率 1000（将来の 1200 は返さない）、企画1〜3・5 のみ
    client, _ = make_client()
    response = client.get("/settings", headers=auth(client))
    assert response.status_code == 200
    body = response.json()
    assert body["tax_rate_bp"] == 1000
    assert [c["campaign_id"] for c in body["campaigns"]] == [1, 2, 3, 5]
    assert body["campaigns"][0] == {
        "campaign_id": 1, "name": "常連感謝トッピング企画", "product_code": "2001",
        "discount_type": "amount", "discount_value": 20,
    }


def test_extra_api5_members():
    # IT-08：{member_id, name} のみ。phone・address を含まない
    client, _ = make_client()
    response = client.get("/members/M000001", headers=auth(client))
    assert response.status_code == 200
    assert response.json() == {"member_id": "M000001", "name": "山田太郎"}


def test_extra_api6_products():
    # IT-11
    client, _ = make_client()
    response = client.get("/products/1001", headers=auth(client))
    assert response.status_code == 200
    assert response.json() == {"product_code": "1001", "name": "醤油ラーメン", "unit_price": 850}


def test_extra_api7_transactions():
    # IT-14：201。totals が一致、lines が3行で値引き額 0／60／85
    client, repos = make_client()
    response = client.post("/transactions", headers=auth(client), json=transaction_body())
    assert response.status_code == 201
    body = response.json()
    assert (body["subtotal"], body["discount_total"], body["tax_amount"], body["total"]) == (2915, 145, 277, 3047)
    assert [line["discount_amount"] for line in body["lines"]] == [0, 60, 85]
    assert body["lines"][0] == {
        "line_no": 1, "product_code": "1001", "product_name": "醤油ラーメン",
        "unit_price": 850, "quantity": 2, "discount_amount": 0,
    }
    assert body["transacted_at"] == "2026-09-05T12:00:00"
    assert isinstance(body["transaction_id"], int)
    assert repos.transactions.saved[body["transaction_id"]].staff_id == "S001"


# ===========================================================================
# 異常系とエラーコードの対応
# ===========================================================================

# --- API 1 login ---------------------------------------------------------------

@pytest.mark.parametrize("staff_id, password", [
    pytest.param("S001", "wrong-password-0000", id="IT-02-wrong-password"),
    pytest.param("S003", "retired-staff-01", id="IT-03-inactive"),
    pytest.param("X999", "ramen-owner-2026", id="ST-38-unknown-id"),
])
def test_extra_login_failures_are_auth_failed(staff_id, password):
    client, _ = make_client()
    body = assert_error(client.post("/auth/login", json={"staff_id": staff_id, "password": password}), 401, "AUTH_FAILED")
    assert body["message"] == "担当者IDまたはパスワードが正しくありません"


def test_extra_login_locked_after_ten_failures():
    # IT-04
    client, _ = make_client()
    for _ in range(10):
        client.post("/auth/login", json={"staff_id": "S004", "password": "wrong-password-0000"})
    response = client.post("/auth/login", json={"staff_id": "S004", "password": "lock-test-user-1"})
    assert_error(response, 423, "AUTH_LOCKED")


def test_extra_login_invalid_input_is_400():
    client, _ = make_client()
    assert_error(client.post("/auth/login", json={"staff_id": "S001", "password": "short"}), 400, "VALIDATION_ERROR")


# --- API 2 refresh・API 3 logout --------------------------------------------------

@pytest.mark.parametrize("headers", [
    pytest.param({}, id="no-header"),
    pytest.param({"Authorization": "Bearer not-issued-token"}, id="unknown-token"),
])
def test_extra_refresh_without_valid_token_is_token_invalid(headers):
    client, _ = make_client()
    assert_error(client.post("/auth/refresh", headers=headers), 401, "TOKEN_INVALID")


def test_extra_refresh_rejects_access_token():
    client, _ = make_client()
    tokens = login(client)
    response = client.post("/auth/refresh", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert_error(response, 401, "TOKEN_INVALID")


def test_extra_logout_requires_access_token():
    client, _ = make_client()
    tokens = login(client)
    assert_error(client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]}), 401, "TOKEN_INVALID")


def test_extra_logout_without_body_is_400():
    client, _ = make_client()
    assert_error(client.post("/auth/logout", headers=auth(client)), 400, "VALIDATION_ERROR")


# --- 認証必須（ST-30） ------------------------------------------------------------

@pytest.mark.parametrize("method, path", [
    pytest.param("GET", "/settings", id="settings"),
    pytest.param("GET", "/members/M000001", id="members"),
    pytest.param("GET", "/products/1001", id="products"),
    pytest.param("POST", "/transactions", id="transactions"),
])
def test_extra_protected_apis_require_token(method, path):
    client, _ = make_client()
    response = client.request(method, path, json=transaction_body() if method == "POST" else None)
    assert_error(response, 401, "TOKEN_INVALID")


# --- API 4 settings --------------------------------------------------------------

@pytest.mark.parametrize("business_now, tax_rate_bp, campaign_ids", [
    pytest.param(datetime(2026, 9, 8, 0, 0, 0), 1000, [5, 6], id="after-campaign-1-3"),
    pytest.param(datetime(2027, 4, 1, 0, 0, 0), 1200, [], id="new-tax-rate"),
])
def test_extra_settings_follow_business_date(business_now, tax_rate_bp, campaign_ids):
    client, _ = make_client(business_now)
    body = client.get("/settings", headers=auth(client)).json()
    assert body["tax_rate_bp"] == tax_rate_bp
    assert [c["campaign_id"] for c in body["campaigns"]] == campaign_ids


# --- API 5 members ---------------------------------------------------------------

def test_extra_member_without_phone_and_address():
    # IT-09
    client, _ = make_client()
    response = client.get("/members/M000002", headers=auth(client))
    assert response.status_code == 200
    assert response.json() == {"member_id": "M000002", "name": "鈴木花子"}


def test_extra_unknown_member_is_404():
    # IT-10
    client, _ = make_client()
    assert_error(client.get("/members/M999999", headers=auth(client)), 404, "MEMBER_NOT_FOUND")


@pytest.mark.parametrize("member_id", [
    pytest.param("m000001", id="lowercase"),
    pytest.param("1001", id="product-code"),
    pytest.param("M1; DROP TABLE member;--", id="ST-34-sql"),
])
def test_extra_invalid_member_id_is_400(member_id):
    client, _ = make_client()
    assert_error(client.get(f"/members/{member_id}", headers=auth(client)), 400, "VALIDATION_ERROR")


# --- API 6 products --------------------------------------------------------------

@pytest.mark.parametrize("code", [pytest.param("9999", id="IT-12-unregistered"), pytest.param("1099", id="IT-13-discontinued")])
def test_extra_unknown_product_is_404(code):
    client, _ = make_client()
    body = assert_error(client.get(f"/products/{code}", headers=auth(client)), 404, "PRODUCT_NOT_FOUND")
    assert body["message"] == "商品がマスタ未登録です"


@pytest.mark.parametrize("code", [
    pytest.param("abc", id="letters"),
    pytest.param("M0001", id="member-id"),
    pytest.param("1001' OR '1'='1", id="ST-33-sql"),
])
def test_extra_invalid_product_code_is_400(code):
    client, _ = make_client()
    assert_error(client.get(f"/products/{code}", headers=auth(client)), 400, "VALIDATION_ERROR")


# --- API 7 transactions ----------------------------------------------------------

def test_extra_transactions_totals_mismatch():
    # IT-15
    client, repos = make_client()
    body = assert_error(
        client.post("/transactions", headers=auth(client), json=transaction_body(totals=(2915, 145, 277, 3048))),
        409, "TOTALS_MISMATCH",
    )
    assert body["details"]["server_totals"] == {"subtotal": 2915, "discount_total": 145, "tax_amount": 277, "total": 3047}
    assert repos.transactions.saved == {}


def test_extra_transactions_duplicate_key():
    # IT-16：2回目は DUPLICATE。details.transaction_id が1回目と同じ。保存は1件
    client, repos = make_client()
    headers = auth(client)
    first = client.post("/transactions", headers=headers, json=transaction_body())
    second = client.post("/transactions", headers=headers, json=transaction_body())
    body = assert_error(second, 409, "DUPLICATE")
    assert body["details"] == {"transaction_id": first.json()["transaction_id"]}
    assert len(repos.transactions.saved) == 1


def test_extra_transactions_concurrent_duplicate_on_save():
    client, repos = make_client()
    repos.transactions.simulate_conflict_on_add_with_id = 7
    body = assert_error(client.post("/transactions", headers=auth(client), json=transaction_body()), 409, "DUPLICATE")
    assert body["details"] == {"transaction_id": 7}


def test_extra_transactions_db_timeout_is_500_without_details():
    # IT-34：保存中に DB が応答しなくなったら 500 INTERNAL_ERROR。SQL 文などの詳細は返さない
    from sqlalchemy.exc import OperationalError

    client, repos = make_client()
    repos.transactions.raise_on_add = OperationalError(
        "INSERT INTO `transaction` ...", {}, Exception("(2013, 'Lost connection to MySQL server during query (timed out)')")
    )
    response = client.post("/transactions", headers=auth(client), json=transaction_body())
    body = assert_error(response, 500, "INTERNAL_ERROR")
    assert body["message"] == "処理に失敗しました。もう一度お試しください"
    assert "INSERT" not in response.text and "timed out" not in response.text
    assert repos.transactions.saved == {}


@pytest.mark.parametrize("body", [
    pytest.param(transaction_body(items=[]), id="IT-17-empty-items"),
    pytest.param(transaction_body(items=[{"product_code": "1001", "quantity": 1}, {"product_code": "1001", "quantity": 1}]), id="IT-37-duplicate-code"),
    pytest.param(transaction_body(items=[{"product_code": "1001", "quantity": 1, "unit_price": 1}]), id="ST-32-unit-price"),
])
def test_extra_transactions_invalid_body_is_400(body):
    client, repos = make_client()
    assert_error(client.post("/transactions", headers=auth(client), json=body), 400, "VALIDATION_ERROR")
    assert repos.transactions.saved == {}


def test_extra_transactions_unknown_product():
    # IT-18
    client, repos = make_client()
    items = [{"product_code": "1001", "quantity": 1}, {"product_code": "9999", "quantity": 1}]
    assert_error(client.post("/transactions", headers=auth(client), json=transaction_body(items=items)), 404, "PRODUCT_NOT_FOUND")
    assert repos.transactions.saved == {}


def test_extra_transactions_unknown_member():
    # IT-36
    client, repos = make_client()
    assert_error(client.post("/transactions", headers=auth(client), json=transaction_body(member_id="M999999")), 404, "MEMBER_NOT_FOUND")
    assert repos.transactions.saved == {}


def test_extra_transactions_without_member():
    # IT-19：金額は UT-B-18
    client, repos = make_client()
    body = transaction_body(member_id=None, items=[{"product_code": "1001", "quantity": 2}], totals=(1700, 0, 170, 1870))
    response = client.post("/transactions", headers=auth(client), json=body)
    assert response.status_code == 201
    assert response.json()["discount_total"] == 0
    assert repos.transactions.saved[response.json()["transaction_id"]].member_id is None


def test_extra_transactions_record_logged_in_staff():
    # IT-32
    client, repos = make_client()
    response = client.post("/transactions", headers=auth(client, "S002"), json=transaction_body())
    assert repos.transactions.saved[response.json()["transaction_id"]].staff_id == "S002"


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
def test_extra_no_update_or_delete_api_for_transactions(method):
    # IT-35：更新・削除 API を設けない
    client, _ = make_client()
    response = client.request(method, "/transactions/1", headers=auth(client))
    assert response.status_code in (404, 405)
