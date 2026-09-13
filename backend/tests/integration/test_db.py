# test_spec.md 5.1.3 外部連携 — DB への保存（IT-29〜33、IT-35）
# BFF（Next.js）経由で取引を確定し、MySQL を直接参照して確認する。期待値は test_spec.md の表の値をそのまま使う
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from tests.integration.helpers import BACKEND_URL, fetch_all, login, transaction_body

JST = timezone(timedelta(hours=9))


def confirm_it_14(bff) -> int:
    """IT-14 と同じ取引（UT-B-19 の明細、会員 M000001）を確定し、取引IDを返す。"""
    response = bff.post("/api/transactions", json=transaction_body())
    assert response.status_code == 201
    return response.json()["transaction_id"]


def test_IT_29_detail_is_snapshot_at_purchase(bff, db):
    login(bff, "S001")
    transaction_id = confirm_it_14(bff)
    rows = fetch_all(
        db,
        "SELECT line_no, product_code, product_name, unit_price, quantity, discount_amount, tax_rate_bp "
        "FROM transaction_detail WHERE transaction_id = %s ORDER BY line_no",
        (transaction_id,),
    )
    assert [(r["product_code"], r["product_name"], r["unit_price"], r["discount_amount"], r["tax_rate_bp"]) for r in rows] == [
        ("1001", "醤油ラーメン", 850, 0, 1000),
        ("2001", "味玉", 120, 60, 1000),
        ("1004", "特製ラーメン", 855, 85, 1000),
    ]


def test_IT_30_history_keeps_price_after_master_change(bff, db):
    login(bff, "S001")
    transaction_id = confirm_it_14(bff)
    fetch_all(db, "UPDATE product SET unit_price = 950 WHERE product_code = '1001'")
    row = fetch_all(
        db,
        "SELECT unit_price FROM transaction_detail WHERE transaction_id = %s AND product_code = '1001'",
        (transaction_id,),
    )[0]
    assert row["unit_price"] == 850


def test_IT_31_history_keeps_tax_rate_after_tax_change(bff, db):
    login(bff, "S001")
    transaction_id = confirm_it_14(bff)
    # 税率マスタに「翌日から 1200」を追加（基準日 9/5 の翌日）
    fetch_all(db, "INSERT INTO tax_rate (tax_category, rate_bp, effective_from) VALUES ('standard', 1200, '2026-09-06')")
    header = fetch_all(db, "SELECT tax_rate_bp FROM `transaction` WHERE transaction_id = %s", (transaction_id,))[0]
    details = fetch_all(db, "SELECT tax_rate_bp FROM transaction_detail WHERE transaction_id = %s", (transaction_id,))
    assert header["tax_rate_bp"] == 1000
    assert {d["tax_rate_bp"] for d in details} == {1000}


def test_IT_32_transaction_records_staff(bff, db):
    login(bff, "S002")
    transaction_id = confirm_it_14(bff)
    row = fetch_all(db, "SELECT staff_id FROM `transaction` WHERE transaction_id = %s", (transaction_id,))[0]
    assert row["staff_id"] == "S002"


@pytest.mark.realtime
def test_IT_33_transacted_at_is_real_time(bff, db):
    # TEST_FIXED_NOW を未設定にして起動した環境で実行する（run_all.sh の 3/3）
    login(bff, "S001")
    # 実時刻では企画の期間が変わるため、値引きのない明細（UT-B-18）を使う
    body = transaction_body(items=[{"product_code": "1001", "quantity": 2}], member_id=None, totals=(1700, 0, 170, 1870))
    response = bff.post("/api/transactions", json=body)
    now = datetime.now(JST).replace(tzinfo=None)
    assert response.status_code == 201
    row = fetch_all(db, "SELECT transacted_at FROM `transaction` WHERE transaction_id = %s", (response.json()["transaction_id"],))[0]
    assert abs(row["transacted_at"] - now) <= timedelta(seconds=5)


def test_IT_35_no_update_or_delete_api(bff, db):
    login(bff, "S001")
    transaction_id = confirm_it_14(bff)
    before = fetch_all(db, "SELECT * FROM `transaction` WHERE transaction_id = %s", (transaction_id,))

    for method in ("PUT", "DELETE"):
        for path in ("/api/transactions", f"/api/transactions/{transaction_id}"):
            response = bff.request(method, path, json=transaction_body())
            assert response.status_code in (404, 405), f"BFF {method} {path} -> {response.status_code}"
        # FastAPI にも更新・削除 API がないこと（本番は内部 Ingress で外部から届かない）
        for path in ("/transactions", f"/transactions/{transaction_id}"):
            response = httpx.request(method, f"{BACKEND_URL}{path}", json=transaction_body(), timeout=10)
            assert response.status_code in (404, 405), f"FastAPI {method} {path} -> {response.status_code}"

    after = fetch_all(db, "SELECT * FROM `transaction` WHERE transaction_id = %s", (transaction_id,))
    assert after == before
