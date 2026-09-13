"""購入確定（design.md 3.2.3、7.3）。

confirm の処理順：
  1. idempotency_key で既存取引を検索 → あれば DUPLICATE（既存の取引ID）
  2. 商品を取得（販売終了を除く）→ 欠けていれば PRODUCT_NOT_FOUND
  3. member_id があれば会員の存在を確認 → なければ MEMBER_NOT_FOUND
  4. 業務用 Clock の日付で税率と企画を取得し、PricingService で再計算
  5. verify_client_totals で照合 → 不一致なら TOTALS_MISMATCH
  6. 取引ヘッダと明細を1つのトランザクションで保存
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from app.core.clock import Clock
from app.schemas.transaction import TransactionRequest
from app.services.pricing import Campaign, Item, PricingService, Totals


class TotalsMismatch(Exception):
    """フロント計算値がバックエンドの再計算と一致しない（409 TOTALS_MISMATCH）。"""

    def __init__(self, server_totals: Totals) -> None:
        super().__init__("client totals do not match server totals")
        self.server_totals = server_totals


class IdempotencyKeyConflict(Exception):
    """同じ idempotency_key の取引が保存済み（同時に確定された場合を含む）。409 DUPLICATE。"""

    def __init__(self, transaction_id: int) -> None:
        super().__init__(f"transaction already exists: {transaction_id}")
        self.transaction_id = transaction_id


class ProductNotFound(Exception):
    """商品コードが未登録または販売終了（404 PRODUCT_NOT_FOUND）。"""

    def __init__(self, product_code: str) -> None:
        super().__init__(f"product not found: {product_code}")
        self.product_code = product_code


class MemberNotFound(Exception):
    """会員IDに該当する会員がない（404 MEMBER_NOT_FOUND）。"""

    def __init__(self, member_id: str) -> None:
        super().__init__(f"member not found: {member_id}")
        self.member_id = member_id


# --- リポジトリが扱うデータ ------------------------------------------------------

@dataclass(frozen=True)
class ProductRecord:
    product_code: str
    name: str
    unit_price: int


@dataclass(frozen=True)
class MemberRecord:
    # 電話番号・住所は扱わない（NFR-SEC-09）
    member_id: str
    name: str


@dataclass(frozen=True)
class CampaignRecord:
    """GET /settings が返す企画（design.md 5.2 DiscountCampaign）。"""

    campaign_id: int
    name: str
    product_code: str
    discount_type: str
    discount_value: int


@dataclass(frozen=True)
class TransactionLine:
    line_no: int
    product_code: str
    product_name: str
    unit_price: int
    quantity: int
    discount_amount: int
    tax_rate_bp: int


@dataclass(frozen=True)
class NewTransaction:
    transacted_at: datetime
    staff_id: str
    member_id: str | None
    totals: Totals
    tax_rate_bp: int
    idempotency_key: str
    lines: list[TransactionLine]


@dataclass(frozen=True)
class ConfirmedTransaction:
    transaction_id: int
    transacted_at: datetime
    totals: Totals
    lines: list[TransactionLine]


# --- リポジトリの形 --------------------------------------------------------------

class ProductRepository(Protocol):
    def find_available(self, product_codes: list[str]) -> dict[str, ProductRecord]:
        """販売終了を除く商品を、商品コードをキーにして返す。"""
        ...


class MemberRepository(Protocol):
    def exists(self, member_id: str) -> bool: ...

    def get(self, member_id: str) -> MemberRecord | None: ...


class TaxRateRepository(Protocol):
    def rate_bp_on(self, day: date) -> int:
        """その日に有効な最新の税率（effective_from <= day のうち最も新しいもの）。"""
        ...


class CampaignRepository(Protocol):
    def find_by_product_codes(self, product_codes: list[str]) -> list[Campaign]:
        """対象商品の企画をすべて返す。期間判定は PricingService が行う。"""
        ...

    def find_active_on(self, day: date) -> list[CampaignRecord]:
        """その日に有効な企画を campaign_id の順に返す（GET /settings）。"""
        ...


class TransactionRepository(Protocol):
    def find_id_by_idempotency_key(self, idempotency_key: str) -> int | None: ...

    def add(self, transaction: NewTransaction) -> int:
        """ヘッダと明細を1つのトランザクションで保存し、取引IDを返す。

        同じ idempotency_key が保存済みなら IdempotencyKeyConflict を投げる。
        """
        ...


class TransactionService:
    def __init__(
        self,
        products: ProductRepository,
        members: MemberRepository,
        tax_rates: TaxRateRepository,
        campaigns: CampaignRepository,
        transactions: TransactionRepository,
        business_clock: Clock,
        pricing: PricingService | None = None,
    ) -> None:
        self._products = products
        self._members = members
        self._tax_rates = tax_rates
        self._campaigns = campaigns
        self._transactions = transactions
        self._business_clock = business_clock
        self._pricing = pricing or PricingService()

    def confirm(self, request: TransactionRequest, staff_id: str) -> ConfirmedTransaction:
        idempotency_key = str(request.idempotency_key)

        # 1. 再送なら、内容を検証する前に既存の取引として扱う
        existing_id = self._transactions.find_id_by_idempotency_key(idempotency_key)
        if existing_id is not None:
            raise IdempotencyKeyConflict(existing_id)

        # 2. 単価は常にマスタの値を使う（design.md 7.3）
        codes = [item.product_code for item in request.items]
        products = self._products.find_available(codes)
        for code in codes:
            if code not in products:
                raise ProductNotFound(code)

        # 3. 会員
        if request.member_id is not None and not self._members.exists(request.member_id):
            raise MemberNotFound(request.member_id)

        # 4. 再計算。取引日時は DATETIME（秒まで）で保存するため、秒に切り捨てて応答と揃える
        now = self._business_clock.now().replace(microsecond=0)
        tax_rate_bp = self._tax_rates.rate_bp_on(now.date())
        campaigns = self._campaigns.find_by_product_codes(codes)
        items = [
            Item(item.product_code, products[item.product_code].unit_price, item.quantity)
            for item in request.items
        ]
        server_totals = self._pricing.calculate(items, request.member_id, campaigns, tax_rate_bp, now)

        # 5. 照合。バックエンドの再計算結果を正とする
        client = request.client_totals
        self.verify_client_totals(
            server_totals,
            Totals(client.subtotal, client.discount_total, client.tax_amount, client.total),
        )

        # 6. 購入時点の商品名・単価・値引き額・税率を明細に転記して保存する（スナップショット）
        lines = [
            TransactionLine(
                line_no=line_no,
                product_code=item.product_code,
                product_name=products[item.product_code].name,
                unit_price=item.unit_price,
                quantity=item.quantity,
                discount_amount=self._pricing.apply_discount(item, request.member_id, campaigns, now),
                tax_rate_bp=tax_rate_bp,
            )
            for line_no, item in enumerate(items, start=1)
        ]
        transaction_id = self._transactions.add(
            NewTransaction(
                transacted_at=now,
                staff_id=staff_id,
                member_id=request.member_id,
                totals=server_totals,
                tax_rate_bp=tax_rate_bp,
                idempotency_key=idempotency_key,
                lines=lines,
            )
        )
        return ConfirmedTransaction(transaction_id, now, server_totals, lines)

    @staticmethod
    def verify_client_totals(server: Totals, client: Totals) -> None:
        """4値（税抜合計・値引き合計・税額・税込合計）が1つでも異なれば TotalsMismatch。"""
        if client != server:
            raise TotalsMismatch(server)
