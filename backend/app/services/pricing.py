"""金額計算の唯一の実装（design.md 3.3、6.1）。

金額は円単位の整数、税率は万分率の整数とし、演算を整数に閉じる。
"""

from dataclasses import dataclass
from datetime import date, datetime

PERCENT = "percent"
AMOUNT = "amount"

QUANTITY_MIN = 1
QUANTITY_MAX = 99
PERCENT_MIN = 1
PERCENT_MAX = 100
AMOUNT_MIN = 1


@dataclass(frozen=True)
class Item:
    product_code: str
    unit_price: int
    quantity: int


@dataclass(frozen=True)
class Campaign:
    product_code: str
    discount_type: str
    discount_value: int
    start_date: date
    end_date: date


@dataclass(frozen=True)
class Totals:
    subtotal: int
    discount_total: int
    tax_amount: int
    total: int


class PricingService:
    def apply_discount(
        self, item: Item, member: str | None, campaigns: list[Campaign], now: datetime
    ) -> int:
        """明細の値引き額（数量分の合計）を返す。"""
        # 不正な企画は会員・対象商品・期間に関わらず拒否する
        for campaign in campaigns:
            _validate_campaign(campaign)

        if member is None:
            return 0

        today = now.date()
        discounts = [
            _discount_for(item, campaign)
            for campaign in campaigns
            if campaign.product_code == item.product_code
            and campaign.start_date <= today <= campaign.end_date
        ]
        # 複数の企画が重なる場合は値引き額が大きい方を1つだけ適用する
        return max(discounts, default=0)

    def calculate(
        self,
        items: list[Item],
        member: str | None,
        campaigns: list[Campaign],
        tax_rate_bp: int,
        now: datetime,
    ) -> Totals:
        if not items:
            raise ValueError("items must not be empty")
        for item in items:
            if not QUANTITY_MIN <= item.quantity <= QUANTITY_MAX:
                raise ValueError(f"quantity out of range: {item.quantity}")
            if item.unit_price < 0:
                raise ValueError(f"unit_price must not be negative: {item.unit_price}")

        subtotal = sum(item.unit_price * item.quantity for item in items)
        discount_total = sum(
            self.apply_discount(item, member, campaigns, now) for item in items
        )
        # 値引き後に課税し、税額の端数は取引全体で1回だけ切り捨てる（BR-02）
        taxable = subtotal - discount_total
        tax_amount = taxable * tax_rate_bp // 10000
        return Totals(
            subtotal=subtotal,
            discount_total=discount_total,
            tax_amount=tax_amount,
            total=taxable + tax_amount,
        )


def _validate_campaign(campaign: Campaign) -> None:
    if campaign.discount_type == PERCENT:
        if not PERCENT_MIN <= campaign.discount_value <= PERCENT_MAX:
            raise ValueError(f"percent out of range: {campaign.discount_value}")
    elif campaign.discount_type == AMOUNT:
        if campaign.discount_value < AMOUNT_MIN:
            raise ValueError(f"amount must be at least 1: {campaign.discount_value}")
    else:
        raise ValueError(f"unknown discount_type: {campaign.discount_type}")


def _discount_for(item: Item, campaign: Campaign) -> int:
    if campaign.discount_type == PERCENT:
        # 単価に対して切り捨ててから数量を掛ける
        return item.unit_price * campaign.discount_value // 100 * item.quantity
    # 金額値引きは単価で頭打ちにし、明細が負にならないようにする
    return min(campaign.discount_value, item.unit_price) * item.quantity
