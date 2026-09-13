# test_spec.md 4.1.1 PricingService.apply_discount／4.1.2 PricingService.calculate
# 期待値は test_spec.md の表の値をそのまま写す（コード内で計算しない）
from datetime import date, datetime

import pytest

from app.services.pricing import Campaign, Item, PricingService

BASE = datetime(2026, 9, 5)  # テスト基準日（test_spec.md 4）
MEMBER = "M1"

# test_spec.md 3.5 の企画
C1 = Campaign(product_code="2001", discount_type="amount", discount_value=20,
              start_date=date(2026, 9, 1), end_date=date(2026, 9, 7))
C5 = Campaign(product_code="1004", discount_type="percent", discount_value=10,
              start_date=date(2026, 9, 1), end_date=date(2026, 9, 30))
C6 = Campaign(product_code="2002", discount_type="amount", discount_value=150,
              start_date=date(2026, 9, 8), end_date=date(2026, 9, 30))


def campaign(product_code: str, discount_type: str, discount_value: int) -> Campaign:
    """表に期間の指定がないケース用の企画。期間は 9/1〜9/30（人間が決定）"""
    return Campaign(product_code=product_code, discount_type=discount_type,
                    discount_value=discount_value,
                    start_date=date(2026, 9, 1), end_date=date(2026, 9, 30))


# ---------------------------------------------------------------------------
# 4.1.1 apply_discount — 値引き額の算出
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("item, member, campaigns, now, expected", [
    pytest.param(Item("2001", 120, 3), None, [C1], BASE, 0, id="UT-B-01"),
    pytest.param(Item("1001", 850, 1), MEMBER, [C1, C5], BASE, 0, id="UT-B-02"),
    pytest.param(Item("2001", 120, 1), MEMBER, [C1], datetime(2026, 8, 31), 0, id="UT-B-03"),
    pytest.param(Item("2001", 120, 1), MEMBER, [C1], datetime(2026, 9, 1), 20, id="UT-B-04"),
    pytest.param(Item("2001", 120, 1), MEMBER, [C1], datetime(2026, 9, 7, 23, 59), 20, id="UT-B-05"),
    pytest.param(Item("2001", 120, 1), MEMBER, [C1], datetime(2026, 9, 8, 0, 0), 0, id="UT-B-06"),
    pytest.param(Item("1004", 855, 1), MEMBER, [C5], BASE, 85, id="UT-B-07"),
    pytest.param(Item("1004", 855, 3), MEMBER, [C5], BASE, 255, id="UT-B-08"),
    pytest.param(Item("1001", 850, 1), MEMBER, [campaign("1001", "percent", 100)], BASE, 850, id="UT-B-09"),
    pytest.param(Item("2001", 120, 3), MEMBER, [C1], BASE, 60, id="UT-B-10"),
    pytest.param(Item("2002", 100, 2), MEMBER, [C6], datetime(2026, 9, 10), 200, id="UT-B-11"),
    pytest.param(Item("5001", 0, 1), MEMBER, [campaign("5001", "percent", 10)], BASE, 0, id="UT-B-12"),
    pytest.param(Item("5001", 0, 1), MEMBER, [campaign("5001", "amount", 20)], BASE, 0, id="UT-B-13"),
    pytest.param(Item("9001", 1, 1), MEMBER, [campaign("9001", "percent", 10)], BASE, 0, id="UT-B-14"),
    pytest.param(Item("5002", 99999, 99), MEMBER, [campaign("5002", "percent", 10)], BASE, 989901, id="UT-B-15"),
    pytest.param(Item("2001", 120, 1), MEMBER, [C1, campaign("2001", "percent", 50)], BASE, 60, id="UT-B-87"),
])
def test_UT_B_01_15_87_apply_discount(item, member, campaigns, now, expected):
    assert PricingService().apply_discount(item, member, campaigns, now) == expected


def test_UT_B_16_unknown_discount_type():
    bad = Campaign("2001", "rate", 10, date(2026, 9, 1), date(2026, 9, 7))
    with pytest.raises(ValueError):
        PricingService().apply_discount(Item("2001", 120, 1), MEMBER, [bad], BASE)


@pytest.mark.parametrize("discount_value", [
    pytest.param(0, id="UT-B-17-percent0"),
    pytest.param(101, id="UT-B-17-percent101"),
])
def test_UT_B_17_percent_out_of_range(discount_value):
    bad = campaign("2001", "percent", discount_value)
    with pytest.raises(ValueError):
        PricingService().apply_discount(Item("2001", 120, 1), MEMBER, [bad], BASE)


# ---------------------------------------------------------------------------
# 4.1.2 calculate — 合計の算出。期待値は（税抜合計、値引き合計、税額、税込合計）
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("items, member, campaigns, tax_rate_bp, expected", [
    pytest.param([Item("1001", 850, 2)], None, [], 1000,
                 (1700, 0, 170, 1870), id="UT-B-18"),
    pytest.param([Item("1001", 850, 2), Item("2001", 120, 3), Item("1004", 855, 1)], MEMBER, [C1, C5], 1000,
                 (2915, 145, 277, 3047), id="UT-B-19"),
    pytest.param([Item("2001", 120, 3)], MEMBER, [C1], 1000,
                 (360, 60, 30, 330), id="UT-B-20"),
    pytest.param([Item("9001", 5, 1)], None, [], 1000,
                 (5, 0, 0, 5), id="UT-B-21"),
    pytest.param([Item("9001", 999, 1)], None, [], 1000,
                 (999, 0, 99, 1098), id="UT-B-22"),
    pytest.param([Item("9001", 1234, 1)], None, [], 1000,
                 (1234, 0, 123, 1357), id="UT-B-23"),
    pytest.param([Item("9001", 1234, 1)], None, [], 0,
                 (1234, 0, 0, 1234), id="UT-B-24"),
    pytest.param([Item("9001", 1234, 1)], None, [], 100,
                 (1234, 0, 12, 1246), id="UT-B-25"),
    pytest.param([Item("9001", 1234, 1)], None, [], 1200,
                 (1234, 0, 148, 1382), id="UT-B-26"),
    pytest.param([Item("5002", 99999, 99)], None, [], 1000,
                 (9899901, 0, 989990, 10889891), id="UT-B-27"),
    pytest.param([Item("1001", 850, 1)], MEMBER, [campaign("1001", "percent", 100)], 1000,
                 (850, 850, 0, 0), id="UT-B-28"),
])
def test_UT_B_18_28_calculate(items, member, campaigns, tax_rate_bp, expected):
    totals = PricingService().calculate(items, member, campaigns, tax_rate_bp, BASE)
    assert (totals.subtotal, totals.discount_total, totals.tax_amount, totals.total) == expected


def test_UT_B_29_empty_items():
    with pytest.raises(ValueError):
        PricingService().calculate([], None, [], 1000, BASE)


def test_UT_B_30_quantity_zero():
    with pytest.raises(ValueError):
        PricingService().calculate([Item("1001", 850, 0)], None, [], 1000, BASE)


def test_UT_B_31_quantity_100():
    with pytest.raises(ValueError):
        PricingService().calculate([Item("1001", 850, 100)], None, [], 1000, BASE)


def test_UT_B_32_negative_unit_price():
    with pytest.raises(ValueError):
        PricingService().calculate([Item("1001", -1, 1)], None, [], 1000, BASE)


# ---------------------------------------------------------------------------
# 本書にケース ID のないテスト
# ---------------------------------------------------------------------------

def test_extra_invalid_campaign_raises_even_without_member():
    # 不正な企画は会員・対象商品・期間に関わらず常に ValueError（人間が決定）
    bad = Campaign("3001", "rate", 10, date(2026, 1, 1), date(2026, 1, 31))
    with pytest.raises(ValueError):
        PricingService().apply_discount(Item("2001", 120, 1), None, [bad], BASE)


def test_extra_amount_below_one_yen_raises():
    # design.md 6.1：値引き額（amount）の下限は 1円
    bad = campaign("2001", "amount", 0)
    with pytest.raises(ValueError):
        PricingService().apply_discount(Item("2001", 120, 1), MEMBER, [bad], BASE)
