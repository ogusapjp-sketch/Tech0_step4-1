"""API 1〜3：ログイン・トークン更新・ログアウト（design.md 3.2.1、5.2）。

トークンは本文で BFF に返し、BFF が Cookie に移す（人間が決定）。
"""

from typing import Annotated

from fastapi import APIRouter, Header, Response

from app.core.errors import ApiError
from app.dependencies import AuthServiceDep, CurrentStaffId, RepositoriesDep, bearer_token
from app.schemas.auth import LoginRequest, LogoutRequest
from app.schemas.responses import LoginTokenResponse, RefreshTokenResponse
from app.services.auth import AuthError

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginTokenResponse)
def login(body: LoginRequest, service: AuthServiceDep, repositories: RepositoriesDep) -> LoginTokenResponse:
    try:
        tokens = service.authenticate(body.staff_id, body.password)
    except AuthError as exc:
        raise ApiError(exc.code) from exc
    staff = repositories.staff.get(body.staff_id)
    return LoginTokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        staff_id=staff.staff_id,
        name=staff.name,
    )


@router.post("/refresh", response_model=RefreshTokenResponse)
def refresh(
    service: AuthServiceDep, authorization: Annotated[str | None, Header()] = None
) -> RefreshTokenResponse:
    # BFF は Cookie のリフレッシュトークンを Authorization ヘッダで送る（design.md 5.2 API 2）
    refresh_token = bearer_token(authorization)
    try:
        tokens = service.refresh(refresh_token)
    except AuthError as exc:
        raise ApiError(exc.code) from exc
    return RefreshTokenResponse(access_token=tokens.access_token, refresh_token=tokens.refresh_token)


@router.post("/logout", status_code=204, response_class=Response)
def logout(body: LogoutRequest, service: AuthServiceDep, _staff_id: CurrentStaffId) -> Response:
    service.revoke(body.refresh_token)
    return Response(status_code=204)
