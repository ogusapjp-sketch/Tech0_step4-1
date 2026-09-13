"""購入確定 API の入力スキーマ（design.md 5.2 API 7、6.1）。"""

from typing import Annotated, Self

from pydantic import (
    UUID4,
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StrictStr,
    model_validator,
)

from app.schemas.codes import validate_member_id, validate_product_code

ProductCode = Annotated[StrictStr, AfterValidator(validate_product_code)]
MemberId = Annotated[StrictStr, AfterValidator(validate_member_id)]
# 暗黙の型変換をしない（"2" や 1.5 を拒否）
Quantity = Annotated[StrictInt, Field(ge=1, le=99)]

ITEMS_MIN = 1
ITEMS_MAX = 50


class TransactionItem(BaseModel):
    # unit_price など定義外のフィールドを拒否し、単価を送らせない（design.md 7.3）
    model_config = ConfigDict(extra="forbid")

    product_code: ProductCode
    quantity: Quantity


class ClientTotals(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subtotal: StrictInt
    discount_total: StrictInt
    tax_amount: StrictInt
    total: StrictInt


class TransactionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idempotency_key: UUID4
    member_id: MemberId | None
    items: Annotated[list[TransactionItem], Field(min_length=ITEMS_MIN, max_length=ITEMS_MAX)]
    client_totals: ClientTotals

    @model_validator(mode="after")
    def reject_duplicate_product_codes(self) -> Self:
        # フロントは同一商品を1行に集約して送る前提（design.md 6.2）
        codes = [item.product_code for item in self.items]
        if len(codes) != len(set(codes)):
            raise ValueError("items must not contain duplicate product_code")
        return self
