"""購入確定（design.md 3.2.3、7.3）。

段階6では金額の照合（verify_client_totals）と、confirm が使うリポジトリの形を定める。
confirm（再計算・照合・保存）は DB を使うため段階8で実装する。想定する処理順：
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

from app.services.pricing import Campaign, Totals


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


# --- confirm が使うリポジトリの形（実装は段階8） ---------------------------------

@dataclass(frozen=True)
class ProductRecord:
    product_code: str
    name: str
    unit_price: int


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


class ProductRepository(Protocol):
    def find_available(self, product_codes: list[str]) -> dict[str, ProductRecord]:
        """販売終了を除く商品を、商品コードをキーにして返す。"""
        ...


class MemberRepository(Protocol):
    def exists(self, member_id: str) -> bool: ...


class TaxRateRepository(Protocol):
    def rate_bp_on(self, day: date) -> int:
        """その日に有効な最新の税率（effective_from <= day のうち最も新しいもの）。"""
        ...


class CampaignRepository(Protocol):
    def find_by_product_codes(self, product_codes: list[str]) -> list[Campaign]:
        """対象商品の企画をすべて返す。期間判定は PricingService が行う。"""
        ...


class TransactionRepository(Protocol):
    def find_id_by_idempotency_key(self, idempotency_key: str) -> int | None: ...

    def add(self, transaction: NewTransaction) -> int:
        """ヘッダと明細を1つのトランザクションで保存し、取引IDを返す。

        同じ idempotency_key が保存済みなら IdempotencyKeyConflict を投げる。
        """
        ...


class TransactionService:
    @staticmethod
    def verify_client_totals(server: Totals, client: Totals) -> None:
        """4値（税抜合計・値引き合計・税額・税込合計）が1つでも異なれば TotalsMismatch。"""
        if client != server:
            raise TotalsMismatch(server)
