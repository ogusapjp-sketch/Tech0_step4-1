"""ルータが使う依存関数。"""

from typing import Annotated

from fastapi import Header, Request

from app.core import security
from app.core.errors import ApiError


def get_current_staff_id(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> str:
    """Authorization: Bearer のアクセストークンを検証し、担当者IDを返す（design.md 7.1）。

    トークンなし・不正は TOKEN_INVALID、期限切れは TOKEN_EXPIRED（BFF が自動更新する）。
    """
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError("TOKEN_INVALID")
    try:
        return security.verify_access_token(
            token.strip(),
            request.app.state.settings.jwt_secret_key,
            request.app.state.token_clock.now(),
        )
    except security.TokenError as exc:
        raise ApiError(exc.code) from exc
