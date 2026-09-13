# test_spec.md 4.1.4 AuthService.authenticate／refresh／revoke（UT-B-65〜79）
# DB は使わず、インメモリの偽リポジトリと、進められる偽の Clock を注入する（test_spec.md 4.3）
from dataclasses import dataclass, replace
from datetime import datetime, timedelta

import jwt
import pytest

from app.core.clock import JST
from app.core.security import hash_password, hash_refresh_token
from app.services.auth import (
    AuthError,
    AuthService,
    AuthSettings,
    RefreshTokenRecord,
    Staff,
    TokenPair,
)

# test_spec.md 3.1 の平文
PASSWORDS = {
    "S001": "ramen-owner-2026",
    "S002": "part-timer-0001",
    "S003": "retired-staff-01",
    "S004": "lock-test-user-1",
}
WRONG_PASSWORD = "wrong-password-0000"
BASE_NOW = datetime(2026, 9, 5, 12, 0, 0)
SECRET = "unit-test-secret-key-0123456789-abcdef"
ACCESS_TOKEN_TTL_SECONDS = 3600

# Argon2id のハッシュ計算は遅いため、モジュールで1回だけ計算する
PASSWORD_HASHES = {staff_id: hash_password(password) for staff_id, password in PASSWORDS.items()}


class MutableClock:
    def __init__(self, now: datetime) -> None:
        self._now = now

    def now(self) -> datetime:
        return self._now

    def advance(self, delta: timedelta) -> None:
        self._now += delta


class InMemoryStaffRepository:
    def __init__(self, staff: list[Staff]) -> None:
        self._rows = {s.staff_id: s for s in staff}

    def get(self, staff_id: str) -> Staff | None:
        row = self._rows.get(staff_id)
        # 保存を呼ばない限り変更が反映されないよう、コピーを返す
        return replace(row) if row else None

    def update(self, staff: Staff) -> None:
        self._rows[staff.staff_id] = replace(staff)


class InMemoryTokenRepository:
    def __init__(self) -> None:
        self.rows: dict[str, RefreshTokenRecord] = {}

    def add(self, record: RefreshTokenRecord) -> None:
        self.rows[record.token_hash] = replace(record)

    def get(self, token_hash: str) -> RefreshTokenRecord | None:
        row = self.rows.get(token_hash)
        return replace(row) if row else None

    def revoke(self, token_hash: str) -> None:
        if token_hash in self.rows:
            self.rows[token_hash] = replace(self.rows[token_hash], revoked=True)

    def revoke_all_for_staff(self, staff_id: str) -> None:
        for token_hash, row in self.rows.items():
            if row.staff_id == staff_id:
                self.rows[token_hash] = replace(row, revoked=True)


@dataclass
class Env:
    service: AuthService
    staff_repo: InMemoryStaffRepository
    token_repo: InMemoryTokenRepository
    business_clock: MutableClock
    token_clock: MutableClock


@pytest.fixture
def env() -> Env:
    staff_repo = InMemoryStaffRepository([
        Staff("S001", "店主", PASSWORD_HASHES["S001"], 0, None, True),
        Staff("S002", "アルバイトA", PASSWORD_HASHES["S002"], 0, None, True),
        Staff("S003", "退職者", PASSWORD_HASHES["S003"], 0, None, False),
        Staff("S004", "ロック検証用", PASSWORD_HASHES["S004"], 0, None, True),
    ])
    token_repo = InMemoryTokenRepository()
    business_clock = MutableClock(BASE_NOW)
    token_clock = MutableClock(BASE_NOW)
    service = AuthService(
        staff_repo,
        token_repo,
        business_clock,
        token_clock,
        AuthSettings(jwt_secret_key=SECRET, access_token_ttl_seconds=ACCESS_TOKEN_TTL_SECONDS),
    )
    return Env(service, staff_repo, token_repo, business_clock, token_clock)


def fail_login(env: Env, staff_id: str, times: int) -> None:
    for _ in range(times):
        with pytest.raises(AuthError):
            env.service.authenticate(staff_id, WRONG_PASSWORD)


def lock_s004(env: Env) -> None:
    fail_login(env, "S004", 10)


def assert_auth_error(code: str, func, *args) -> None:
    with pytest.raises(AuthError) as excinfo:
        func(*args)
    assert excinfo.value.code == code


# ---------------------------------------------------------------------------
# authenticate
# ---------------------------------------------------------------------------

def test_UT_B_65_success(env):
    pair = env.service.authenticate("S001", PASSWORDS["S001"])
    assert isinstance(pair, TokenPair)
    assert pair.access_token and pair.refresh_token
    assert env.staff_repo.get("S001").failed_count == 0


def test_UT_B_66_wrong_password(env):
    assert_auth_error("AUTH_FAILED", env.service.authenticate, "S001", WRONG_PASSWORD)
    assert env.staff_repo.get("S001").failed_count == 1


def test_UT_B_67_unknown_staff_id(env):
    assert_auth_error("AUTH_FAILED", env.service.authenticate, "X999", PASSWORDS["S001"])


def test_UT_B_68_inactive_staff(env):
    assert_auth_error("AUTH_FAILED", env.service.authenticate, "S003", PASSWORDS["S003"])


def test_UT_B_69_nine_failures_do_not_lock(env):
    fail_login(env, "S004", 8)
    assert_auth_error("AUTH_FAILED", env.service.authenticate, "S004", WRONG_PASSWORD)
    assert env.staff_repo.get("S004").locked_until is None


def test_UT_B_70_tenth_failure_locks(env):
    lock_s004(env)
    assert env.staff_repo.get("S004").locked_until == datetime(2026, 9, 5, 12, 30, 0)


def test_UT_B_71_locked_with_correct_password(env):
    lock_s004(env)
    failed_count_before = env.staff_repo.get("S004").failed_count
    assert_auth_error("AUTH_LOCKED", env.service.authenticate, "S004", PASSWORDS["S004"])
    assert env.staff_repo.get("S004").failed_count == failed_count_before


def test_UT_B_72_locked_with_wrong_password(env):
    lock_s004(env)
    assert_auth_error("AUTH_LOCKED", env.service.authenticate, "S004", WRONG_PASSWORD)


def test_UT_B_73_still_locked_at_29m59s(env):
    lock_s004(env)
    env.business_clock.advance(timedelta(minutes=29, seconds=59))
    assert_auth_error("AUTH_LOCKED", env.service.authenticate, "S004", PASSWORDS["S004"])


def test_UT_B_74_unlocked_at_30m00s(env):
    lock_s004(env)
    env.business_clock.advance(timedelta(minutes=30, seconds=0))
    pair = env.service.authenticate("S004", PASSWORDS["S004"])
    assert isinstance(pair, TokenPair)
    assert env.staff_repo.get("S004").failed_count == 0


def test_UT_B_75_success_after_failures_resets_count(env):
    fail_login(env, "S001", 3)
    env.service.authenticate("S001", PASSWORDS["S001"])
    assert env.staff_repo.get("S001").failed_count == 0


# ---------------------------------------------------------------------------
# refresh ／ revoke
# ---------------------------------------------------------------------------

def test_UT_B_76_refresh_rotates_tokens(env):
    old = env.service.authenticate("S001", PASSWORDS["S001"])
    new = env.service.refresh(old.refresh_token)
    assert isinstance(new, TokenPair)
    assert new.refresh_token != old.refresh_token
    assert env.token_repo.get(hash_refresh_token(old.refresh_token)).revoked is True


def test_UT_B_77_refresh_with_revoked_token(env):
    pair = env.service.authenticate("S001", PASSWORDS["S001"])
    env.service.revoke(pair.refresh_token)
    assert env.token_repo.get(hash_refresh_token(pair.refresh_token)).revoked is True
    assert_auth_error("TOKEN_INVALID", env.service.refresh, pair.refresh_token)


def test_UT_B_78_refresh_one_second_after_expiry(env):
    pair = env.service.authenticate("S001", PASSWORDS["S001"])
    env.token_clock.advance(timedelta(hours=12, seconds=1))
    assert_auth_error("TOKEN_INVALID", env.service.refresh, pair.refresh_token)


def test_UT_B_79_logout_revokes(env):
    pair = env.service.authenticate("S001", PASSWORDS["S001"])
    env.service.revoke(pair.refresh_token)
    assert env.token_repo.get(hash_refresh_token(pair.refresh_token)).revoked is True


# ---------------------------------------------------------------------------
# 本書にケース ID のないテスト
# ---------------------------------------------------------------------------

def test_extra_tenth_failure_returns_auth_failed(env):
    # design.md 3.2.1：パスワード不一致の応答は 401。ロック中の応答（423）は次回から
    fail_login(env, "S004", 9)
    assert_auth_error("AUTH_FAILED", env.service.authenticate, "S004", WRONG_PASSWORD)


def test_extra_lock_resets_failed_count(env):
    # design.md 7.1：ロック発生時に failed_count を 0 に戻す
    lock_s004(env)
    assert env.staff_repo.get("S004").failed_count == 0


def test_extra_counting_restarts_after_unlock(env):
    # design.md 7.1：解除後は再び10回から数える
    lock_s004(env)
    env.business_clock.advance(timedelta(minutes=30))
    fail_login(env, "S004", 9)
    staff = env.staff_repo.get("S004")
    assert staff.failed_count == 9
    assert staff.locked_until <= env.business_clock.now()


def test_extra_success_after_unlock_clears_locked_until(env):
    # 人間が決定：解除後の成功で locked_until を NULL に戻す
    lock_s004(env)
    env.business_clock.advance(timedelta(minutes=30))
    env.service.authenticate("S004", PASSWORDS["S004"])
    assert env.staff_repo.get("S004").locked_until is None


def test_extra_lock_revokes_refresh_tokens(env):
    # design.md 7.1：アカウントロック時にリフレッシュトークンを失効させる
    pair = env.service.authenticate("S004", PASSWORDS["S004"])
    lock_s004(env)
    assert env.token_repo.get(hash_refresh_token(pair.refresh_token)).revoked is True


def test_extra_lock_uses_business_clock(env):
    lock_s004(env)
    env.token_clock.advance(timedelta(minutes=30))
    assert_auth_error("AUTH_LOCKED", env.service.authenticate, "S004", PASSWORDS["S004"])


def test_extra_inactive_staff_failure_is_not_counted(env):
    # 人間が決定：無効化済みの担当者は存在しない ID と同じ扱いにし、失敗回数を加算しない
    assert_auth_error("AUTH_FAILED", env.service.authenticate, "S003", WRONG_PASSWORD)
    assert env.staff_repo.get("S003").failed_count == 0


def test_extra_inactive_and_locked_staff_returns_auth_failed(env):
    # 人間が決定：無効化済みならロック中でも AUTH_LOCKED を返さない
    locked = replace(env.staff_repo.get("S003"), locked_until=datetime(2026, 9, 5, 12, 30, 0))
    env.staff_repo.update(locked)
    assert_auth_error("AUTH_FAILED", env.service.authenticate, "S003", PASSWORDS["S003"])


def test_extra_refresh_rejected_after_staff_deactivated(env):
    # 人間が決定：無効化された担当者の refresh は TOKEN_INVALID
    pair = env.service.authenticate("S002", PASSWORDS["S002"])
    env.staff_repo.update(replace(env.staff_repo.get("S002"), is_active=False))
    assert_auth_error("TOKEN_INVALID", env.service.refresh, pair.refresh_token)


def test_extra_refresh_exactly_at_expiry_is_invalid(env):
    # 人間が決定：現在 = expires_at は無効
    pair = env.service.authenticate("S001", PASSWORDS["S001"])
    env.token_clock.advance(timedelta(hours=12))
    assert_auth_error("TOKEN_INVALID", env.service.refresh, pair.refresh_token)


def test_extra_refresh_one_second_before_expiry_is_valid(env):
    pair = env.service.authenticate("S001", PASSWORDS["S001"])
    env.token_clock.advance(timedelta(hours=11, minutes=59, seconds=59))
    assert isinstance(env.service.refresh(pair.refresh_token), TokenPair)


def test_extra_refresh_expiry_uses_token_clock(env):
    pair = env.service.authenticate("S001", PASSWORDS["S001"])
    env.business_clock.advance(timedelta(hours=13))
    assert isinstance(env.service.refresh(pair.refresh_token), TokenPair)


def test_extra_refresh_with_unknown_token(env):
    assert_auth_error("TOKEN_INVALID", env.service.refresh, "not-issued-token")


def test_extra_rotated_refresh_token_cannot_be_reused(env):
    old = env.service.authenticate("S001", PASSWORDS["S001"])
    new = env.service.refresh(old.refresh_token)
    assert_auth_error("TOKEN_INVALID", env.service.refresh, old.refresh_token)
    assert isinstance(env.service.refresh(new.refresh_token), TokenPair)


def test_extra_revoke_unknown_token_does_nothing(env):
    # design.md 5.2 API 3：ログアウトは常に 204（エラーを定めていない）
    env.service.revoke("not-issued-token")


def test_extra_refresh_token_is_stored_as_sha256_with_12h_expiry(env):
    # design.md 4.1・7.1：トークンそのものではなく SHA-256 を保存。有効期間は12時間
    pair = env.service.authenticate("S001", PASSWORDS["S001"])
    assert pair.refresh_token not in env.token_repo.rows
    record = env.token_repo.get(hash_refresh_token(pair.refresh_token))
    assert len(record.token_hash) == 64
    assert record.staff_id == "S001"
    assert record.expires_at == datetime(2026, 9, 6, 0, 0, 0)
    assert record.revoked is False


def test_extra_access_token_claims(env):
    # design.md 7.1：HS256、sub に担当者ID、有効期間は token_clock から ACCESS_TOKEN_TTL_SECONDS
    pair = env.service.authenticate("S001", PASSWORDS["S001"])
    claims = jwt.decode(pair.access_token, SECRET, algorithms=["HS256"], options={"verify_exp": False})
    assert claims["sub"] == "S001"
    assert claims["iat"] == int(datetime(2026, 9, 5, 12, 0, 0, tzinfo=JST).timestamp())
    assert claims["exp"] == int(datetime(2026, 9, 5, 13, 0, 0, tzinfo=JST).timestamp())
