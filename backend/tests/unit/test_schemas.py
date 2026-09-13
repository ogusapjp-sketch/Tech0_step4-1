# test_spec.md 4.1.3 Pydantic スキーマ検証（UT-B-33〜64、86）
# 期待値（受理／拒否）は test_spec.md の表の値をそのまま写す
import pytest
from pydantic import ValidationError

from app.schemas import (
    ClientTotals,
    LoginRequest,
    TransactionItem,
    TransactionRequest,
    validate_member_id,
    validate_product_code,
)

VALID_UUID4 = "3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f"
VALID_PASSWORD = "ramen-owner-2026"
ACCEPT = "受理"
REJECT = "拒否"


def transaction_request(**overrides) -> dict:
    body = {
        "idempotency_key": VALID_UUID4,
        "member_id": "M000001",
        "items": [{"product_code": "1001", "quantity": 1}],
        "client_totals": {"subtotal": 850, "discount_total": 0, "tax_amount": 85, "total": 935},
    }
    body.update(overrides)
    return body


def distinct_items(count: int) -> list[dict]:
    return [{"product_code": str(1000 + i), "quantity": 1} for i in range(count)]


def assert_result(validate, expected: str) -> None:
    if expected == ACCEPT:
        validate()
    else:
        with pytest.raises(ValueError):  # pydantic.ValidationError も ValueError の派生
            validate()


# --- 数量（TransactionItem.quantity） -------------------------------------------

@pytest.mark.parametrize("quantity, expected", [
    pytest.param(1, ACCEPT, id="UT-B-33"),
    pytest.param(99, ACCEPT, id="UT-B-34"),
    pytest.param(0, REJECT, id="UT-B-35"),
    pytest.param(100, REJECT, id="UT-B-36"),
    pytest.param(-1, REJECT, id="UT-B-37"),
    pytest.param(1.5, REJECT, id="UT-B-38"),
    pytest.param("2", REJECT, id="UT-B-39"),
])
def test_UT_B_33_39_quantity(quantity, expected):
    assert_result(
        lambda: TransactionItem.model_validate({"product_code": "1001", "quantity": quantity}),
        expected,
    )


# --- 商品コード（validate_product_code） ---------------------------------------

@pytest.mark.parametrize("product_code, expected", [
    pytest.param("1001", ACCEPT, id="UT-B-40"),
    pytest.param("", REJECT, id="UT-B-41"),
    pytest.param("abc", REJECT, id="UT-B-42"),
    pytest.param("M0001", REJECT, id="UT-B-43"),
    pytest.param("1" * 20, ACCEPT, id="UT-B-44"),
    pytest.param("1" * 21, REJECT, id="UT-B-45"),
    pytest.param(" 1001 ", REJECT, id="UT-B-86"),
])
def test_UT_B_40_45_86_product_code(product_code, expected):
    assert_result(lambda: validate_product_code(product_code), expected)


# --- 会員ID（validate_member_id、TransactionRequest.member_id） -----------------

@pytest.mark.parametrize("member_id, expected", [
    pytest.param("M1", ACCEPT, id="UT-B-46"),
    pytest.param("M", REJECT, id="UT-B-47"),
    pytest.param("m000001", REJECT, id="UT-B-48"),
    pytest.param("1001", REJECT, id="UT-B-49"),
    pytest.param("M" + "1" * 19, ACCEPT, id="UT-B-50"),
    pytest.param("M" + "1" * 20, REJECT, id="UT-B-51"),
])
def test_UT_B_46_51_member_id(member_id, expected):
    assert_result(lambda: validate_member_id(member_id), expected)


def test_UT_B_52_member_id_null():
    request = TransactionRequest.model_validate(transaction_request(member_id=None))
    assert request.member_id is None


# --- パスワード・担当者ID（LoginRequest） --------------------------------------

@pytest.mark.parametrize("password, expected", [
    pytest.param("a" * 11, REJECT, id="UT-B-53"),
    pytest.param("a" * 12, ACCEPT, id="UT-B-54"),
    pytest.param("a" * 128, ACCEPT, id="UT-B-55"),
    pytest.param("a" * 129, REJECT, id="UT-B-56"),
])
def test_UT_B_53_56_password(password, expected):
    assert_result(
        lambda: LoginRequest.model_validate({"staff_id": "S001", "password": password}),
        expected,
    )


@pytest.mark.parametrize("staff_id, expected", [
    pytest.param("S-001_a", ACCEPT, id="UT-B-57"),
    pytest.param("S 001", REJECT, id="UT-B-58"),
])
def test_UT_B_57_58_staff_id(staff_id, expected):
    assert_result(
        lambda: LoginRequest.model_validate({"staff_id": staff_id, "password": VALID_PASSWORD}),
        expected,
    )


# --- 明細の件数（TransactionRequest.items） ------------------------------------

@pytest.mark.parametrize("count, expected", [
    pytest.param(0, REJECT, id="UT-B-59"),
    pytest.param(50, ACCEPT, id="UT-B-60"),
    pytest.param(51, REJECT, id="UT-B-61"),
])
def test_UT_B_59_61_items_count(count, expected):
    assert_result(
        lambda: TransactionRequest.model_validate(transaction_request(items=distinct_items(count))),
        expected,
    )


# --- 冪等キー（TransactionRequest.idempotency_key） ----------------------------

@pytest.mark.parametrize("idempotency_key, expected", [
    pytest.param(VALID_UUID4, ACCEPT, id="UT-B-62"),
    pytest.param("abc", REJECT, id="UT-B-63"),
])
def test_UT_B_62_63_idempotency_key(idempotency_key, expected):
    assert_result(
        lambda: TransactionRequest.model_validate(transaction_request(idempotency_key=idempotency_key)),
        expected,
    )


# --- 未知のフィールド ----------------------------------------------------------

def test_UT_B_64_unit_price_in_item_rejected():
    items = [{"product_code": "1001", "quantity": 1, "unit_price": 1}]
    with pytest.raises(ValidationError):
        TransactionRequest.model_validate(transaction_request(items=items))


# ---------------------------------------------------------------------------
# 本書にケース ID のないテスト
# ---------------------------------------------------------------------------

def test_extra_duplicate_product_codes_rejected():
    # design.md 6.2：items に同一商品コードが複数ある場合は VALIDATION_ERROR（IT-37 と同じ条件）
    items = [{"product_code": "1001", "quantity": 1}, {"product_code": "1001", "quantity": 2}]
    with pytest.raises(ValidationError):
        TransactionRequest.model_validate(transaction_request(items=items))


def test_extra_transaction_item_uses_product_code_validation():
    with pytest.raises(ValidationError):
        TransactionItem.model_validate({"product_code": " 1001 ", "quantity": 1})


def test_extra_transaction_request_uses_member_id_validation():
    with pytest.raises(ValidationError):
        TransactionRequest.model_validate(transaction_request(member_id="m000001"))


@pytest.mark.parametrize("schema, body", [
    pytest.param(LoginRequest, {"staff_id": "S001", "password": VALID_PASSWORD}, id="LoginRequest"),
    pytest.param(TransactionItem, {"product_code": "1001", "quantity": 1}, id="TransactionItem"),
    pytest.param(ClientTotals, {"subtotal": 0, "discount_total": 0, "tax_amount": 0, "total": 0}, id="ClientTotals"),
    pytest.param(TransactionRequest, transaction_request(), id="TransactionRequest"),
])
def test_extra_all_schemas_forbid_unknown_fields(schema, body):
    schema.model_validate(body)
    with pytest.raises(ValidationError):
        schema.model_validate({**body, "unknown": 1})


def test_extra_client_totals_rejects_string_amount():
    with pytest.raises(ValidationError):
        ClientTotals.model_validate({"subtotal": "850", "discount_total": 0, "tax_amount": 85, "total": 935})


def test_extra_idempotency_key_rejects_non_v4_uuid():
    # UUID v1（13文字目が 1）は v4 ではない
    uuid_v1 = "3f2b8c1e-5d4a-1b6c-9e7f-1a2b3c4d5e6f"
    with pytest.raises(ValidationError):
        TransactionRequest.model_validate(transaction_request(idempotency_key=uuid_v1))
