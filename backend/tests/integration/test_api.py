# test_spec.md 5.1.1 インターフェース — API の入出力（IT-01〜20、IT-36・37）
# BFF（Next.js）経由で呼び出す。期待値は test_spec.md の表の値をそのまま使う
import time

import pytest

from tests.integration.helpers import (
    WRONG_PASSWORD,
    count_transactions,
    fetch_all,
    has_no_stack_trace,
    login,
    new_key,
    set_cookies,
    transaction_body,
)


# --- API 1 login -------------------------------------------------------------

def test_IT_01_login_returns_staff_only_and_sets_token_cookies(bff):
    response = login(bff, "S001")
    assert response.status_code == 200
    # ボディは {staff_id, name} のみ。トークンを含めない
    assert response.json() == {"staff_id": "S001", "name": "店主"}
    cookies = set_cookies(response)
    for name in ("pos_access_token", "pos_refresh_token"):
        assert name in cookies
        assert "httponly" in cookies[name].lower()


def test_IT_02_login_wrong_password(bff):
    response = login(bff, "S001", WRONG_PASSWORD)
    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_FAILED"
    assert has_no_stack_trace(response)


def test_IT_03_login_inactive_staff_same_as_unknown(bff):
    inactive = login(bff, "S003")
    unknown = bff.post("/api/auth/login", json={"staff_id": "X999", "password": "retired-staff-01"})
    assert inactive.status_code == 401
    assert inactive.json()["code"] == "AUTH_FAILED"
    # 存在しない場合と同一応答
    assert (inactive.status_code, inactive.json()) == (unknown.status_code, unknown.json())


def test_IT_04_login_locked_after_ten_failures(bff):
    for _ in range(10):
        login(bff, "S004", WRONG_PASSWORD)
    response = login(bff, "S004")
    assert response.status_code == 423
    assert response.json()["code"] == "AUTH_LOCKED"


# --- API 2 refresh -----------------------------------------------------------

@pytest.mark.ttl5
def test_IT_05_refresh_is_transparent_after_access_token_expires(bff):
    # ACCESS_TOKEN_TTL_SECONDS=5 で起動した環境で実行する（run_all.sh の 2/3）
    assert login(bff, "S001").status_code == 200
    time.sleep(6)
    response = bff.get("/api/products/1001")
    # BFF が自動更新し、200 で商品が返る。ブラウザには 401 が届かない
    assert response.status_code == 200
    assert response.json() == {"product_code": "1001", "name": "醤油ラーメン", "unit_price": 850}
    assert "pos_access_token" in set_cookies(response)


# --- API 3 logout ------------------------------------------------------------

def test_IT_06_product_lookup_after_logout_is_token_invalid(bff):
    assert login(bff, "S001").status_code == 200
    assert bff.post("/api/auth/logout").status_code == 204
    response = bff.get("/api/products/1001")
    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"


# --- API 4 settings ----------------------------------------------------------

def test_IT_07_settings_returns_current_tax_rate_and_active_campaigns(bff):
    login(bff, "S001")
    response = bff.get("/api/settings")
    assert response.status_code == 200
    body = response.json()
    # 基準日 9/5：tax_rate_bp は 1000（将来日付の 1200 を返さない）、企画は1〜3・5 のみ
    assert body["tax_rate_bp"] == 1000
    assert [c["campaign_id"] for c in body["campaigns"]] == [1, 2, 3, 5]


# --- API 5 members -----------------------------------------------------------

def test_IT_08_member_without_phone_and_address(bff):
    login(bff, "S001")
    response = bff.get("/api/members/M000001")
    assert response.status_code == 200
    assert response.json() == {"member_id": "M000001", "name": "山田太郎"}


def test_IT_09_member_with_null_phone_and_address(bff):
    login(bff, "S001")
    response = bff.get("/api/members/M000002")
    assert response.status_code == 200


def test_IT_10_unknown_member(bff):
    login(bff, "S001")
    response = bff.get("/api/members/M999999")
    assert response.status_code == 404
    assert response.json()["code"] == "MEMBER_NOT_FOUND"


# --- API 6 products ----------------------------------------------------------

def test_IT_11_product(bff):
    login(bff, "S001")
    response = bff.get("/api/products/1001")
    assert response.status_code == 200
    assert response.json() == {"product_code": "1001", "name": "醤油ラーメン", "unit_price": 850}


def test_IT_12_unknown_product(bff):
    login(bff, "S001")
    response = bff.get("/api/products/9999")
    assert response.status_code == 404
    assert response.json()["code"] == "PRODUCT_NOT_FOUND"


def test_IT_13_discontinued_product(bff):
    login(bff, "S001")
    response = bff.get("/api/products/1099")
    assert response.status_code == 404
    assert response.json()["code"] == "PRODUCT_NOT_FOUND"


# --- API 7 transactions ------------------------------------------------------

def test_IT_14_transaction(bff):
    login(bff, "S001")
    response = bff.post("/api/transactions", json=transaction_body())
    assert response.status_code == 201
    body = response.json()
    assert (body["subtotal"], body["discount_total"], body["tax_amount"], body["total"]) == (2915, 145, 277, 3047)
    assert len(body["lines"]) == 3
    assert [line["discount_amount"] for line in body["lines"]] == [0, 60, 85]


def test_IT_15_totals_mismatch(bff, db):
    login(bff, "S001")
    response = bff.post("/api/transactions", json=transaction_body(totals=(2915, 145, 277, 3048)))
    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "TOTALS_MISMATCH"
    assert body["details"]["server_totals"] == {"subtotal": 2915, "discount_total": 145, "tax_amount": 277, "total": 3047}
    assert count_transactions(db) == 0


def test_IT_16_duplicate_idempotency_key(bff, db):
    login(bff, "S001")
    key = new_key()
    first = bff.post("/api/transactions", json=transaction_body(key=key))
    second = bff.post("/api/transactions", json=transaction_body(key=key))
    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["code"] == "DUPLICATE"
    assert second.json()["details"]["transaction_id"] == first.json()["transaction_id"]
    assert count_transactions(db) == 1


def test_IT_17_empty_items(bff):
    login(bff, "S001")
    response = bff.post("/api/transactions", json=transaction_body(items=[]))
    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_IT_18_unknown_product_is_not_saved(bff, db):
    login(bff, "S001")
    items = [{"product_code": "1001", "quantity": 1}, {"product_code": "9999", "quantity": 1}]
    response = bff.post("/api/transactions", json=transaction_body(items=items))
    assert response.status_code == 404
    assert response.json()["code"] == "PRODUCT_NOT_FOUND"
    assert count_transactions(db) == 0
    assert fetch_all(db, "SELECT COUNT(*) AS n FROM transaction_detail")[0]["n"] == 0


def test_IT_19_transaction_without_member(bff, db):
    login(bff, "S001")
    # 明細は UT-B-18（非会員・醤油850×2）と同じ
    body = transaction_body(items=[{"product_code": "1001", "quantity": 2}], member_id=None, totals=(1700, 0, 170, 1870))
    response = bff.post("/api/transactions", json=body)
    assert response.status_code == 201
    assert response.json()["discount_total"] == 0
    row = fetch_all(db, "SELECT member_id FROM `transaction` WHERE transaction_id = %s", (response.json()["transaction_id"],))[0]
    assert row["member_id"] is None


def test_IT_36_unknown_member_in_transaction_is_not_saved(bff, db):
    login(bff, "S001")
    response = bff.post("/api/transactions", json=transaction_body(member_id="M999999"))
    assert response.status_code == 404
    assert response.json()["code"] == "MEMBER_NOT_FOUND"
    assert count_transactions(db) == 0


def test_IT_37_duplicate_product_code_in_items(bff):
    login(bff, "S001")
    items = [{"product_code": "1001", "quantity": 1}, {"product_code": "1001", "quantity": 1}]
    response = bff.post("/api/transactions", json=transaction_body(items=items))
    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"


# --- 共通 --------------------------------------------------------------------

def test_IT_20_unknown_endpoint(bff):
    response = bff.get("/api/xxx")
    assert response.status_code == 404
    assert has_no_stack_trace(response)
