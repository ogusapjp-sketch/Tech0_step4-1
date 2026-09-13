"""TransactionService が使うリポジトリ（app/services/transaction.py の Protocol）の SQLAlchemy 版。

クエリは ORM とパラメータバインドで発行し、文字列連結で SQL を組み立てない（design.md 7.5）。
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    DiscountCampaignModel,
    MemberModel,
    ProductModel,
    TaxRateModel,
    TransactionDetailModel,
    TransactionModel,
)
from app.services.pricing import Campaign
from app.services.transaction import IdempotencyKeyConflict, NewTransaction, ProductRecord

# Lv2 の税率区分は standard のみ（design.md 4.2）
STANDARD_TAX_CATEGORY = "standard"


class SqlProductRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def find_available(self, product_codes: list[str]) -> dict[str, ProductRecord]:
        rows = self._session.scalars(
            select(ProductModel).where(
                ProductModel.product_code.in_(product_codes),
                ProductModel.is_discontinued.is_(False),
            )
        )
        return {
            row.product_code: ProductRecord(
                product_code=row.product_code, name=row.name, unit_price=row.unit_price
            )
            for row in rows
        }


class SqlMemberRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def exists(self, member_id: str) -> bool:
        return self._session.get(MemberModel, member_id) is not None


class SqlTaxRateRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def rate_bp_on(self, day: date) -> int:
        rate_bp = self._session.scalar(
            select(TaxRateModel.rate_bp)
            .where(
                TaxRateModel.tax_category == STANDARD_TAX_CATEGORY,
                TaxRateModel.effective_from <= day,
            )
            .order_by(TaxRateModel.effective_from.desc())
            .limit(1)
        )
        if rate_bp is None:
            raise LookupError(f"no tax rate effective on {day}")
        return rate_bp


class SqlCampaignRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def find_by_product_codes(self, product_codes: list[str]) -> list[Campaign]:
        rows = self._session.scalars(
            select(DiscountCampaignModel).where(DiscountCampaignModel.product_code.in_(product_codes))
        )
        return [
            Campaign(
                product_code=row.product_code,
                discount_type=row.discount_type,
                discount_value=row.discount_value,
                start_date=row.start_date,
                end_date=row.end_date,
            )
            for row in rows
        ]


class SqlTransactionRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def find_id_by_idempotency_key(self, idempotency_key: str) -> int | None:
        return self._session.scalar(
            select(TransactionModel.transaction_id).where(
                TransactionModel.idempotency_key == idempotency_key
            )
        )

    def add(self, transaction: NewTransaction) -> int:
        row = TransactionModel(
            transacted_at=transaction.transacted_at,
            staff_id=transaction.staff_id,
            member_id=transaction.member_id,
            subtotal=transaction.totals.subtotal,
            discount_total=transaction.totals.discount_total,
            tax_amount=transaction.totals.tax_amount,
            total=transaction.totals.total,
            tax_rate_bp=transaction.tax_rate_bp,
            idempotency_key=transaction.idempotency_key,
            lines=[
                TransactionDetailModel(
                    line_no=line.line_no,
                    product_code=line.product_code,
                    product_name=line.product_name,
                    unit_price=line.unit_price,
                    quantity=line.quantity,
                    discount_amount=line.discount_amount,
                    tax_rate_bp=line.tax_rate_bp,
                )
                for line in transaction.lines
            ],
        )
        self._session.add(row)
        # ヘッダと明細を1つのトランザクションで確定する。失敗したらどちらも残さない
        try:
            self._session.commit()
        except IntegrityError:
            self._session.rollback()
            # 同じ idempotency_key が同時に確定された場合は、既存の取引として扱う
            existing_id = self.find_id_by_idempotency_key(transaction.idempotency_key)
            if existing_id is None:
                raise
            raise IdempotencyKeyConflict(existing_id) from None
        return row.transaction_id
