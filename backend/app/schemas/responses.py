"""API の出力スキーマ（design.md 5.2）。

LoginTokenResponse・RefreshTokenResponse は FastAPI から BFF への内部応答（人間が決定）。
BFF はトークンを Cookie に移し、ブラウザには LoginResponse（または本文なし）を返す。
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class _Schema(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- API 1・2（FastAPI → BFF の内部応答） ----------------------------------------

class LoginTokenResponse(_Schema):
    access_token: str
    refresh_token: str
    staff_id: str
    name: str


class RefreshTokenResponse(_Schema):
    access_token: str
    refresh_token: str


# --- API 1（BFF → ブラウザ） ---------------------------------------------------

class LoginResponse(_Schema):
    staff_id: str
    name: str


# --- API 4〜7 ---------------------------------------------------------------

class DiscountCampaign(_Schema):
    campaign_id: int
    name: str
    product_code: str
    discount_type: Literal["percent", "amount"]
    discount_value: int


class Settings(_Schema):
    tax_rate_bp: int
    campaigns: list[DiscountCampaign]


class Member(_Schema):
    # 電話番号・住所は含めない（NFR-SEC-09）
    member_id: str
    name: str


class Product(_Schema):
    product_code: str
    name: str
    unit_price: int


class TransactionLineResponse(_Schema):
    line_no: int
    product_code: str
    product_name: str
    unit_price: int
    quantity: int
    discount_amount: int


class TransactionResponse(_Schema):
    transaction_id: int
    transacted_at: datetime
    subtotal: int
    discount_total: int
    tax_amount: int
    total: int
    lines: list[TransactionLineResponse]


# --- 共通：エラーレスポンス -----------------------------------------------------

class ServerTotals(_Schema):
    subtotal: int
    discount_total: int
    tax_amount: int
    total: int


class ErrorDetails(_Schema):
    server_totals: ServerTotals | None = None
    transaction_id: int | None = None


class ErrorResponse(_Schema):
    code: str
    message: str
    details: ErrorDetails | None = None
