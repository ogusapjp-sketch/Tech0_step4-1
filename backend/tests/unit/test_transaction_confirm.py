# TransactionService.confirm（design.md 3.2.3）。DB は使わずインメモリの偽リポジトリを注入する
# test_spec.md 4.1 にケース ID がないため test_extra_。金額の期待値は UT-B-18・19・26 と IT-14・15 の表の値を使う
from datetime import date, datetime

import pytest

from app.core.clock import FixedClock
from app.schemas import TransactionRequest
from app.services.pricing import Totals
from app.services.transaction import (
    IdempotencyKeyConflict,
    MemberNotFound,
    ProductNotFound,
    TotalsMismatch,
    TransactionLine,
    TransactionService,
)
from tests.unit.fakes import (
    InMemoryProductRepository,
    InMemoryTaxRateRepository,
    ProductRow,
    seed_repositories,
)

KEY = "3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f"
# マイクロ秒を含む時刻（保存時に秒へ切り捨てることの確認用）
BASE_NOW = datetime(2026, 9, 5, 12, 0, 0, 123456)

UT_B_19_ITEMS = [
    {"product_code": "1001", "quantity": 2},
    {"product_code": "2001", "quantity": 3},
    {"product_code": "1004", "quantity": 1},
]


def request(items=None, member_id="M000001", totals=(2915, 145, 277, 3047), key=KEY) -> TransactionRequest:
    subtotal, discount_total, tax_amount, total = totals
    return TransactionRequest.model_validate({
        "idempotency_key": key,
        "member_id": member_id,
        "items": UT_B_19_ITEMS if items is None else items,
        "client_totals": {"subtotal": subtotal, "discount_total": discount_total,
                          "tax_amount": tax_amount, "total": total},
    })


def make_service(repositories=None, now: datetime = BASE_NOW):
    repositories = repositories or seed_repositories()
    service = TransactionService(
        products=repositories.products,
        members=repositories.members,
        tax_rates=repositories.tax_rates,
        campaigns=repositories.campaigns,
        transactions=repositories.transactions,
        business_clock=FixedClock(now),
    )
    return service, repositories


def test_extra_confirm_recalculates_and_saves_snapshot():
    # IT-14・IT-29 と同じ内容：UT-B-19 の明細、値引き 0／60／85
    service, repos = make_service()
    confirmed = service.confirm(request(), staff_id="S002")

    assert confirmed.totals == Totals(2915, 145, 277, 3047)
    assert confirmed.transacted_at == datetime(2026, 9, 5, 12, 0, 0)
    saved = repos.transactions.saved[confirmed.transaction_id]
    assert saved.staff_id == "S002"
    assert saved.member_id == "M000001"
    assert saved.idempotency_key == KEY
    assert saved.tax_rate_bp == 1000
    assert saved.transacted_at == datetime(2026, 9, 5, 12, 0, 0)
    assert saved.totals == Totals(2915, 145, 277, 3047)
    assert saved.lines == [
        TransactionLine(1, "1001", "醤油ラーメン", 850, 2, 0, 1000),
        TransactionLine(2, "2001", "味玉", 120, 3, 60, 1000),
        TransactionLine(3, "1004", "特製ラーメン", 855, 1, 85, 1000),
    ]
    assert confirmed.lines == saved.lines


def test_extra_confirm_without_member_applies_no_discount():
    # IT-19 と同じ条件。金額は UT-B-18（非会員・醤油850×2）
    service, repos = make_service()
    confirmed = service.confirm(
        request(items=[{"product_code": "1001", "quantity": 2}], member_id=None, totals=(1700, 0, 170, 1870)),
        staff_id="S001",
    )
    saved = repos.transactions.saved[confirmed.transaction_id]
    assert saved.member_id is None
    assert saved.totals == Totals(1700, 0, 170, 1870)


def test_extra_confirm_uses_tax_rate_on_business_date():
    # 業務用 Clock の日付で税率を選ぶ（FR-012）。金額は UT-B-26（単価1234×1、税率1200）
    repos = seed_repositories()
    repos = repos.__class__(**{**repos.__dict__, "products": InMemoryProductRepository([ProductRow("9001", "テスト商品", 1234, False)])})
    service, repos = make_service(repos, now=datetime(2027, 4, 1, 11, 0, 0))
    confirmed = service.confirm(
        request(items=[{"product_code": "9001", "quantity": 1}], member_id=None, totals=(1234, 0, 148, 1382)),
        staff_id="S001",
    )
    assert repos.transactions.saved[confirmed.transaction_id].tax_rate_bp == 1200


def test_extra_confirm_duplicate_key_returns_existing_id_before_other_checks():
    # 再送（IT-16）：保存済みなら金額などを検証する前に既存の取引IDを返す
    service, repos = make_service()
    first = service.confirm(request(), staff_id="S001")
    with pytest.raises(IdempotencyKeyConflict) as excinfo:
        service.confirm(request(totals=(0, 0, 0, 0)), staff_id="S001")
    assert excinfo.value.transaction_id == first.transaction_id
    assert len(repos.transactions.saved) == 1


@pytest.mark.parametrize("code", [pytest.param("9999", id="unregistered"), pytest.param("1099", id="discontinued")])
def test_extra_confirm_unknown_product_is_not_saved(code):
    # IT-18：部分保存しない。販売終了も未登録と同じ扱い
    service, repos = make_service()
    items = [{"product_code": "1001", "quantity": 1}, {"product_code": code, "quantity": 1}]
    with pytest.raises(ProductNotFound):
        service.confirm(request(items=items), staff_id="S001")
    assert repos.transactions.saved == {}


def test_extra_confirm_unknown_member_is_not_saved():
    # IT-36
    service, repos = make_service()
    with pytest.raises(MemberNotFound):
        service.confirm(request(member_id="M999999"), staff_id="S001")
    assert repos.transactions.saved == {}


def test_extra_confirm_checks_products_before_member():
    service, _ = make_service()
    with pytest.raises(ProductNotFound):
        service.confirm(request(items=[{"product_code": "9999", "quantity": 1}], member_id="M999999"), staff_id="S001")


def test_extra_confirm_totals_mismatch_is_not_saved():
    # IT-15：total を 3048 にすると server_totals に (2915,145,277,3047)
    service, repos = make_service()
    with pytest.raises(TotalsMismatch) as excinfo:
        service.confirm(request(totals=(2915, 145, 277, 3048)), staff_id="S001")
    assert excinfo.value.server_totals == Totals(2915, 145, 277, 3047)
    assert repos.transactions.saved == {}


def test_extra_confirm_concurrent_duplicate_on_save_is_conflict():
    # 検索の後、保存の瞬間に同じキーが先に確定された場合
    service, repos = make_service()
    repos.transactions.simulate_conflict_on_add_with_id = 7
    with pytest.raises(IdempotencyKeyConflict) as excinfo:
        service.confirm(request(), staff_id="S001")
    assert excinfo.value.transaction_id == 7


def test_extra_confirm_missing_tax_rate_raises():
    repos = seed_repositories()
    repos = repos.__class__(**{**repos.__dict__, "tax_rates": InMemoryTaxRateRepository([(1000, date(2030, 1, 1))])})
    service, _ = make_service(repos)
    with pytest.raises(LookupError):
        service.confirm(request(), staff_id="S001")
