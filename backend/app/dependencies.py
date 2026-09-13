"""ルータが使う依存関数。"""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header, Request

from app.core import security
from app.core.clock import Clock
from app.core.errors import ApiError
from app.services.auth import AuthService, AuthSettings
from app.services.repositories import Repositories
from app.services.transaction import TransactionService


def bearer_token(authorization: str | None) -> str:
    """Authorization: Bearer <token> からトークンを取り出す。なければ TOKEN_INVALID。"""
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError("TOKEN_INVALID")
    return token.strip()


def get_current_staff_id(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> str:
    """アクセストークンを検証し、担当者IDを返す（design.md 7.1）。

    トークンなし・不正は TOKEN_INVALID、期限切れは TOKEN_EXPIRED（BFF が自動更新する）。
    """
    token = bearer_token(authorization)
    try:
        return security.verify_access_token(
            token,
            request.app.state.settings.jwt_secret_key,
            request.app.state.token_clock.now(),
        )
    except security.TokenError as exc:
        raise ApiError(exc.code) from exc


def get_repositories(request: Request) -> Iterator[Repositories]:
    """1リクエストにつき1組（本番では1つの DB セッション）。"""
    with request.app.state.repositories_provider() as repositories:
        yield repositories


def get_business_clock(request: Request) -> Clock:
    return request.app.state.business_clock


CurrentStaffId = Annotated[str, Depends(get_current_staff_id)]
RepositoriesDep = Annotated[Repositories, Depends(get_repositories)]
BusinessClockDep = Annotated[Clock, Depends(get_business_clock)]


def get_auth_service(request: Request, repositories: RepositoriesDep) -> AuthService:
    settings = request.app.state.settings
    return AuthService(
        repositories.staff,
        repositories.tokens,
        request.app.state.business_clock,
        request.app.state.token_clock,
        AuthSettings(
            jwt_secret_key=settings.jwt_secret_key,
            access_token_ttl_seconds=settings.access_token_ttl_seconds,
        ),
    )


def get_transaction_service(
    repositories: RepositoriesDep, business_clock: BusinessClockDep
) -> TransactionService:
    return TransactionService(
        products=repositories.products,
        members=repositories.members,
        tax_rates=repositories.tax_rates,
        campaigns=repositories.campaigns,
        transactions=repositories.transactions,
        business_clock=business_clock,
    )


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
TransactionServiceDep = Annotated[TransactionService, Depends(get_transaction_service)]
