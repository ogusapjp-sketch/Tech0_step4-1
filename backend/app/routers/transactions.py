"""API 7：購入確定（design.md 3.2.3、5.2）。取引の更新・削除 API は設けない（NFR-OPS-04）。"""

from fastapi import APIRouter

from app.core.errors import ApiError, api_error
from app.dependencies import CurrentStaffId, TransactionServiceDep
from app.schemas.responses import TransactionLineResponse, TransactionResponse
from app.schemas.transaction import TransactionRequest
from app.services.transaction import (
    IdempotencyKeyConflict,
    MemberNotFound,
    ProductNotFound,
    TotalsMismatch,
)

router = APIRouter(tags=["transactions"])


@router.post("/transactions", status_code=201, response_model=TransactionResponse)
def create_transaction(
    body: TransactionRequest, staff_id: CurrentStaffId, service: TransactionServiceDep
) -> TransactionResponse:
    try:
        confirmed = service.confirm(body, staff_id)
    except IdempotencyKeyConflict as exc:
        raise api_error("DUPLICATE", transaction_id=exc.transaction_id) from exc
    except TotalsMismatch as exc:
        raise api_error("TOTALS_MISMATCH", server_totals=exc.server_totals) from exc
    except ProductNotFound as exc:
        raise ApiError("PRODUCT_NOT_FOUND") from exc
    except MemberNotFound as exc:
        raise ApiError("MEMBER_NOT_FOUND") from exc

    return TransactionResponse(
        transaction_id=confirmed.transaction_id,
        transacted_at=confirmed.transacted_at,
        subtotal=confirmed.totals.subtotal,
        discount_total=confirmed.totals.discount_total,
        tax_amount=confirmed.totals.tax_amount,
        total=confirmed.totals.total,
        lines=[
            TransactionLineResponse(
                line_no=line.line_no,
                product_code=line.product_code,
                product_name=line.product_name,
                unit_price=line.unit_price,
                quantity=line.quantity,
                discount_amount=line.discount_amount,
            )
            for line in confirmed.lines
        ],
    )
