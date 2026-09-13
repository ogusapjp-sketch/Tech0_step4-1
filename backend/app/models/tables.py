"""SQLAlchemy モデル（design.md 4.2）。

テーブルは schema.sql（管理者権限で実行する DDL）で作成し、アプリからは作成しない。
モデルと schema.sql の一致は tests/unit/test_models.py で確認する。
日時はすべて日本時間・タイムゾーン情報なし（design.md 2.3）。
"""

from datetime import date, datetime

from sqlalchemy import CHAR, BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class StaffModel(Base):
    __tablename__ = "staff"

    staff_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    password_hash: Mapped[str] = mapped_column(String(255))
    failed_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("TRUE"))


class MemberModel(Base):
    __tablename__ = "member"

    member_id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(String(200))
    gender: Mapped[str | None] = mapped_column(String(10))
    age: Mapped[int | None] = mapped_column(Integer)


class ProductModel(Base):
    __tablename__ = "product"

    product_code: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    unit_price: Mapped[int] = mapped_column(Integer)
    is_discontinued: Mapped[bool] = mapped_column(Boolean, server_default=text("FALSE"))


class TaxRateModel(Base):
    __tablename__ = "tax_rate"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tax_category: Mapped[str] = mapped_column(String(20), server_default=text("'standard'"))
    rate_bp: Mapped[int] = mapped_column(Integer)
    effective_from: Mapped[date] = mapped_column(Date)


class DiscountCampaignModel(Base):
    __tablename__ = "discount_campaign"

    campaign_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100))
    product_code: Mapped[str] = mapped_column(String(20), ForeignKey("product.product_code"))
    discount_type: Mapped[str] = mapped_column(String(10))
    discount_value: Mapped[int] = mapped_column(Integer)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)


class TransactionModel(Base):
    __tablename__ = "transaction"
    # schema.sql と同じく、キーワードと同じ名前のため常に引用符で囲む
    __table_args__ = {"quote": True}

    transaction_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    transacted_at: Mapped[datetime] = mapped_column(DateTime)
    staff_id: Mapped[str] = mapped_column(String(20), ForeignKey("staff.staff_id"))
    member_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("member.member_id"))
    subtotal: Mapped[int] = mapped_column(Integer)
    discount_total: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    tax_amount: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    tax_rate_bp: Mapped[int] = mapped_column(Integer)
    idempotency_key: Mapped[str] = mapped_column(CHAR(36), unique=True)

    lines: Mapped[list["TransactionDetailModel"]] = relationship(
        cascade="all, delete-orphan", order_by="TransactionDetailModel.line_no"
    )


class TransactionDetailModel(Base):
    __tablename__ = "transaction_detail"

    transaction_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("transaction.transaction_id"), primary_key=True
    )
    line_no: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 商品マスタへの外部キーは張らない（スナップショット、design.md 4.1）
    product_code: Mapped[str] = mapped_column(String(20))
    product_name: Mapped[str] = mapped_column(String(100))
    unit_price: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    discount_amount: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    tax_rate_bp: Mapped[int] = mapped_column(Integer)


class RefreshTokenModel(Base):
    __tablename__ = "refresh_token"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    staff_id: Mapped[str] = mapped_column(String(20), ForeignKey("staff.staff_id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, server_default=text("FALSE"))
