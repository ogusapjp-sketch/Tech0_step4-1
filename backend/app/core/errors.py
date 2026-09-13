"""エラー応答（design.md 5.2 ErrorResponse、6.2）。

業務上の失敗は HTTP ステータスとエラーコードの組で返し、スタックトレースや SQL 文を含めない。
利用者向けの文言はフロントが持ち、ここでの message は補助情報とする。
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.schemas.responses import ErrorDetails, ErrorResponse, ServerTotals
from app.services.pricing import Totals

logger = logging.getLogger(__name__)

# コード → (HTTP ステータス, 補助メッセージ)
ERRORS: dict[str, tuple[int, str]] = {
    "VALIDATION_ERROR": (400, "入力値が不正です"),
    "AUTH_FAILED": (401, "担当者IDまたはパスワードが正しくありません"),
    "TOKEN_EXPIRED": (401, "アクセストークンの有効期限が切れています"),
    "TOKEN_INVALID": (401, "認証が必要です"),
    "AUTH_LOCKED": (423, "一定時間後に再試行してください"),
    "MEMBER_NOT_FOUND": (404, "該当する会員が存在しません"),
    "PRODUCT_NOT_FOUND": (404, "商品がマスタ未登録です"),
    "TOTALS_MISMATCH": (409, "金額の再計算が必要です。画面を更新してください"),
    "DUPLICATE": (409, "既に確定済みの取引です"),
    "INTERNAL_ERROR": (500, "処理に失敗しました。もう一度お試しください"),
}


class ApiError(Exception):
    def __init__(self, code: str, details: ErrorDetails | None = None) -> None:
        super().__init__(code)
        self.status_code, self.message = ERRORS[code]
        self.code = code
        self.details = details


def api_error(
    code: str, *, server_totals: Totals | None = None, transaction_id: int | None = None
) -> ApiError:
    details = None
    if server_totals is not None or transaction_id is not None:
        details = ErrorDetails(
            server_totals=ServerTotals(
                subtotal=server_totals.subtotal,
                discount_total=server_totals.discount_total,
                tax_amount=server_totals.tax_amount,
                total=server_totals.total,
            )
            if server_totals is not None
            else None,
            transaction_id=transaction_id,
        )
    return ApiError(code, details)


def _to_response(error: ApiError) -> JSONResponse:
    body = ErrorResponse(code=error.code, message=error.message, details=error.details)
    return JSONResponse(status_code=error.status_code, content=body.model_dump(exclude_none=True))


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return _to_response(exc)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return _to_response(ApiError("VALIDATION_ERROR"))

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        # 詳細はサーバ側のログにのみ記録する
        logger.error("unexpected error", exc_info=exc)
        return _to_response(ApiError("INTERNAL_ERROR"))
