"""認証（design.md 3.2.1、7.1）。

- ロック判定は業務用 Clock、JWT とリフレッシュトークンの期限はトークン用 Clock で判定する（design.md 6.3）
- 存在しない ID・無効化済み・パスワード誤りは同一の AUTH_FAILED（NFR-SEC-05）
"""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Protocol

from app.core import security
from app.core.clock import Clock

MAX_FAILED_ATTEMPTS = 10
LOCK_DURATION = timedelta(minutes=30)
REFRESH_TOKEN_TTL = timedelta(hours=12)

AUTH_FAILED = "AUTH_FAILED"
AUTH_LOCKED = "AUTH_LOCKED"
TOKEN_INVALID = "TOKEN_INVALID"


@dataclass
class Staff:
    staff_id: str
    name: str
    password_hash: str
    failed_count: int
    locked_until: datetime | None
    is_active: bool


@dataclass
class RefreshTokenRecord:
    token_hash: str
    staff_id: str
    expires_at: datetime
    revoked: bool = False


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str


@dataclass(frozen=True)
class AuthSettings:
    jwt_secret_key: str
    access_token_ttl_seconds: int


class AuthError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class StaffRepository(Protocol):
    def get(self, staff_id: str) -> Staff | None: ...

    def update(self, staff: Staff) -> None: ...


class TokenRepository(Protocol):
    def add(self, record: RefreshTokenRecord) -> None: ...

    def get(self, token_hash: str) -> RefreshTokenRecord | None: ...

    def revoke(self, token_hash: str) -> None: ...

    def revoke_all_for_staff(self, staff_id: str) -> None: ...


class AuthService:
    def __init__(
        self,
        staff_repo: StaffRepository,
        token_repo: TokenRepository,
        business_clock: Clock,
        token_clock: Clock,
        settings: AuthSettings,
    ) -> None:
        self._staff_repo = staff_repo
        self._token_repo = token_repo
        self._business_clock = business_clock
        self._token_clock = token_clock
        self._settings = settings

    def authenticate(self, staff_id: str, password: str) -> TokenPair:
        staff = self._staff_repo.get(staff_id)
        # 無効化済みは存在しない ID と同じ扱い：照合も失敗回数の加算もせず、ロック中かどうかも返さない
        if staff is None or not staff.is_active:
            security.verify_dummy_password(password)
            raise AuthError(AUTH_FAILED)

        self._check_lock(staff)

        if not security.verify_password(staff.password_hash, password):
            self._record_failure(staff)
            raise AuthError(AUTH_FAILED)

        self._staff_repo.update(replace(staff, failed_count=0, locked_until=None))
        return self._issue_tokens(staff.staff_id)

    def refresh(self, refresh_token: str) -> TokenPair:
        record = self._token_repo.get(security.hash_refresh_token(refresh_token))
        # 期限ちょうど（現在 = expires_at）は無効
        if record is None or record.revoked or self._token_clock.now() >= record.expires_at:
            raise AuthError(TOKEN_INVALID)

        staff = self._staff_repo.get(record.staff_id)
        if staff is None or not staff.is_active:
            raise AuthError(TOKEN_INVALID)

        # ローテーション：旧トークンを失効させ、新しい組を発行する
        self._token_repo.revoke(record.token_hash)
        return self._issue_tokens(staff.staff_id)

    def revoke(self, refresh_token: str) -> None:
        self._token_repo.revoke(security.hash_refresh_token(refresh_token))

    def _check_lock(self, staff: Staff) -> None:
        if staff.locked_until is not None and self._business_clock.now() < staff.locked_until:
            raise AuthError(AUTH_LOCKED)

    def _record_failure(self, staff: Staff) -> None:
        failed_count = staff.failed_count + 1
        if failed_count < MAX_FAILED_ATTEMPTS:
            self._staff_repo.update(replace(staff, failed_count=failed_count))
            return
        # ロック発生時は失敗回数を 0 に戻し、発行済みのリフレッシュトークンを失効させる
        locked_until = self._business_clock.now() + LOCK_DURATION
        self._staff_repo.update(replace(staff, failed_count=0, locked_until=locked_until))
        self._token_repo.revoke_all_for_staff(staff.staff_id)

    def _issue_tokens(self, staff_id: str) -> TokenPair:
        now = self._token_clock.now()
        access_token = security.create_access_token(
            staff_id, now, self._settings.jwt_secret_key, self._settings.access_token_ttl_seconds
        )
        refresh_token = security.generate_refresh_token()
        self._token_repo.add(
            RefreshTokenRecord(
                token_hash=security.hash_refresh_token(refresh_token),
                staff_id=staff_id,
                expires_at=now + REFRESH_TOKEN_TTL,
            )
        )
        return TokenPair(access_token=access_token, refresh_token=refresh_token)
