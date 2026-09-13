"""単体テスト用のインメモリ リポジトリ。初期データは test_spec.md 3 のテストデータ。"""

from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass, replace
from datetime import date

from app.core.security import hash_password
from app.services.auth import RefreshTokenRecord, Staff
from app.services.pricing import Campaign
from app.services.repositories import Repositories
from app.services.transaction import (
    CampaignRecord,
    IdempotencyKeyConflict,
    MemberRecord,
    NewTransaction,
    ProductRecord,
)

# test_spec.md 3.1 の平文
PASSWORDS = {
    "S001": "ramen-owner-2026",
    "S002": "part-timer-0001",
    "S003": "retired-staff-01",
    "S004": "lock-test-user-1",
}
# Argon2id のハッシュ計算は遅いため、モジュールで1回だけ計算する
_PASSWORD_HASHES = {staff_id: hash_password(password) for staff_id, password in PASSWORDS.items()}


class InMemoryStaffRepository:
    def __init__(self) -> None:
        self._rows = {
            s.staff_id: s
            for s in [
                Staff("S001", "店主", _PASSWORD_HASHES["S001"], 0, None, True),
                Staff("S002", "アルバイトA", _PASSWORD_HASHES["S002"], 0, None, True),
                Staff("S003", "退職者", _PASSWORD_HASHES["S003"], 0, None, False),
                Staff("S004", "ロック検証用", _PASSWORD_HASHES["S004"], 0, None, True),
            ]
        }

    def get(self, staff_id: str) -> Staff | None:
        row = self._rows.get(staff_id)
        return replace(row) if row else None

    def update(self, staff: Staff) -> None:
        self._rows[staff.staff_id] = replace(staff)


class InMemoryTokenRepository:
    def __init__(self) -> None:
        self.rows: dict[str, RefreshTokenRecord] = {}

    def add(self, record: RefreshTokenRecord) -> None:
        self.rows[record.token_hash] = replace(record)

    def get(self, token_hash: str) -> RefreshTokenRecord | None:
        row = self.rows.get(token_hash)
        return replace(row) if row else None

    def revoke(self, token_hash: str) -> None:
        if token_hash in self.rows:
            self.rows[token_hash] = replace(self.rows[token_hash], revoked=True)

    def revoke_all_for_staff(self, staff_id: str) -> None:
        for token_hash, row in self.rows.items():
            if row.staff_id == staff_id:
                self.rows[token_hash] = replace(row, revoked=True)


@dataclass(frozen=True)
class ProductRow:
    product_code: str
    name: str
    unit_price: int
    is_discontinued: bool


SEED_PRODUCTS = [
    ProductRow("1001", "醤油ラーメン", 850, False),
    ProductRow("1002", "味噌ラーメン", 900, False),
    ProductRow("1003", "冷やし中華", 950, False),
    ProductRow("1004", "特製ラーメン", 855, False),
    ProductRow("2001", "味玉", 120, False),
    ProductRow("2002", "のり", 100, False),
    ProductRow("2003", "メンマ", 150, False),
    ProductRow("3001", "餃子", 400, False),
    ProductRow("4001", "瓶ビール", 500, False),
    ProductRow("5001", "サービス品", 0, False),
    ProductRow("5002", "上限価格品", 99999, False),
    ProductRow("1099", "旧メニュー", 900, True),
]


class InMemoryProductRepository:
    def __init__(self, rows: list[ProductRow] | None = None) -> None:
        self._rows = {r.product_code: r for r in (SEED_PRODUCTS if rows is None else rows)}

    def find_available(self, product_codes: list[str]) -> dict[str, ProductRecord]:
        return {
            code: ProductRecord(row.product_code, row.name, row.unit_price)
            for code in product_codes
            if (row := self._rows.get(code)) is not None and not row.is_discontinued
        }


class InMemoryMemberRepository:
    def __init__(self) -> None:
        self._rows = {
            "M000001": MemberRecord("M000001", "山田太郎"),
            "M000002": MemberRecord("M000002", "鈴木花子"),
        }

    def exists(self, member_id: str) -> bool:
        return member_id in self._rows

    def get(self, member_id: str) -> MemberRecord | None:
        return self._rows.get(member_id)


class InMemoryTaxRateRepository:
    def __init__(self, rates: list[tuple[int, date]] | None = None) -> None:
        self._rates = rates if rates is not None else [(1000, date(2019, 10, 1)), (1200, date(2027, 4, 1))]

    def rate_bp_on(self, day: date) -> int:
        effective = [(start, rate) for rate, start in self._rates if start <= day]
        if not effective:
            raise LookupError(f"no tax rate effective on {day}")
        return max(effective)[1]


@dataclass(frozen=True)
class CampaignRow:
    campaign_id: int
    name: str
    product_code: str
    discount_type: str
    discount_value: int
    start_date: date
    end_date: date


SEED_CAMPAIGNS = [
    CampaignRow(1, "常連感謝トッピング企画", "2001", "amount", 20, date(2026, 9, 1), date(2026, 9, 7)),
    CampaignRow(2, "常連感謝トッピング企画", "2002", "amount", 20, date(2026, 9, 1), date(2026, 9, 7)),
    CampaignRow(3, "常連感謝トッピング企画", "2003", "amount", 20, date(2026, 9, 1), date(2026, 9, 7)),
    CampaignRow(4, "夏の冷やし応援", "1003", "percent", 10, date(2026, 7, 1), date(2026, 8, 31)),
    CampaignRow(5, "端数検証用", "1004", "percent", 10, date(2026, 9, 1), date(2026, 9, 30)),
    CampaignRow(6, "値引き上限検証用", "2002", "amount", 150, date(2026, 9, 8), date(2026, 9, 30)),
]


class InMemoryCampaignRepository:
    def __init__(self) -> None:
        self._rows = SEED_CAMPAIGNS

    def find_by_product_codes(self, product_codes: list[str]) -> list[Campaign]:
        return [
            Campaign(r.product_code, r.discount_type, r.discount_value, r.start_date, r.end_date)
            for r in self._rows
            if r.product_code in product_codes
        ]

    def find_active_on(self, day: date) -> list[CampaignRecord]:
        return [
            CampaignRecord(r.campaign_id, r.name, r.product_code, r.discount_type, r.discount_value)
            for r in self._rows
            if r.start_date <= day <= r.end_date
        ]


class InMemoryTransactionRepository:
    def __init__(self) -> None:
        self.saved: dict[int, NewTransaction] = {}
        # True にすると、保存の瞬間に同じキーが先に確定された状況（同時確定）を再現する
        self.simulate_conflict_on_add_with_id: int | None = None

    def find_id_by_idempotency_key(self, idempotency_key: str) -> int | None:
        for transaction_id, transaction in self.saved.items():
            if transaction.idempotency_key == idempotency_key:
                return transaction_id
        return None

    def add(self, transaction: NewTransaction) -> int:
        if self.simulate_conflict_on_add_with_id is not None:
            raise IdempotencyKeyConflict(self.simulate_conflict_on_add_with_id)
        existing_id = self.find_id_by_idempotency_key(transaction.idempotency_key)
        if existing_id is not None:
            raise IdempotencyKeyConflict(existing_id)
        transaction_id = len(self.saved) + 1
        self.saved[transaction_id] = transaction
        return transaction_id


def seed_repositories() -> Repositories:
    return Repositories(
        staff=InMemoryStaffRepository(),
        tokens=InMemoryTokenRepository(),
        products=InMemoryProductRepository(),
        members=InMemoryMemberRepository(),
        tax_rates=InMemoryTaxRateRepository(),
        campaigns=InMemoryCampaignRepository(),
        transactions=InMemoryTransactionRepository(),
    )


def provider_for(repositories: Repositories):
    def provide() -> AbstractContextManager[Repositories]:
        return nullcontext(repositories)

    return provide
