"""パスワードハッシュとトークンの発行（design.md 7.1）。"""

import hashlib
import secrets
from datetime import datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.clock import JST

JWT_ALGORITHM = "HS256"
TOKEN_EXPIRED = "TOKEN_EXPIRED"
TOKEN_INVALID = "TOKEN_INVALID"


class TokenError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code

# argon2-cffi の既定パラメータ（Argon2id）
_password_hasher = PasswordHasher()
# 存在しない・無効化済みの担当者でも照合と同程度の時間をかけ、応答時間から存在有無を推測されにくくする
_DUMMY_PASSWORD_HASH = _password_hasher.hash("dummy-password-for-timing")


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def verify_dummy_password(password: str) -> None:
    verify_password(_DUMMY_PASSWORD_HASH, password)


def create_access_token(staff_id: str, now: datetime, secret: str, ttl_seconds: int) -> str:
    """now はトークン用 Clock の値（日本時間・タイムゾーン情報なし）。"""
    issued_at = now.replace(tzinfo=JST)
    payload = {
        "sub": staff_id,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + timedelta(seconds=ttl_seconds)).timestamp()),
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def verify_access_token(token: str, secret: str, now: datetime) -> str:
    """担当者ID（sub）を返す。期限は now（トークン用 Clock の値）で判定する。"""
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            # 期限は PyJWT の実時刻ではなくトークン用 Clock で判定する
            options={"require": ["sub", "exp"], "verify_exp": False, "verify_iat": False},
        )
    except jwt.InvalidTokenError as exc:
        raise TokenError(TOKEN_INVALID) from exc

    staff_id = claims["sub"]
    expires_at = claims["exp"]
    if not isinstance(staff_id, str) or type(expires_at) is not int:
        raise TokenError(TOKEN_INVALID)
    # exp は「その時刻以降は受け付けない」
    if int(now.replace(tzinfo=JST).timestamp()) >= expires_at:
        raise TokenError(TOKEN_EXPIRED)
    return staff_id


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_refresh_token(refresh_token: str) -> str:
    """DB にはトークンそのものではなく SHA-256 を保存する（design.md 4.1）。"""
    return hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
