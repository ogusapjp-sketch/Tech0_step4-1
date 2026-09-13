# アクセストークンの検証（design.md 6.2 TOKEN_EXPIRED／TOKEN_INVALID、7.1）
# 期限はトークン用 Clock の時刻で判定する。test_spec.md にケース ID がないため test_extra_
from datetime import datetime, timedelta

import jwt
import pytest

from app.core.clock import JST
from app.core.security import (
    TokenError,
    create_access_token,
    generate_refresh_token,
    verify_access_token,
)

SECRET = "unit-test-secret-key-0123456789-abcdef"
ISSUED_AT = datetime(2026, 9, 5, 12, 0, 0)
EXP = int(datetime(2026, 9, 5, 13, 0, 0, tzinfo=JST).timestamp())


def token_for(now: datetime = ISSUED_AT) -> str:
    return create_access_token("S001", now, SECRET, 3600)


def assert_token_error(code: str, token: str, now: datetime) -> None:
    with pytest.raises(TokenError) as excinfo:
        verify_access_token(token, SECRET, now)
    assert excinfo.value.code == code


def test_extra_valid_token_returns_staff_id():
    assert verify_access_token(token_for(), SECRET, ISSUED_AT) == "S001"


def test_extra_one_second_before_exp_is_valid():
    assert verify_access_token(token_for(), SECRET, datetime(2026, 9, 5, 12, 59, 59)) == "S001"


def test_extra_at_exp_is_expired():
    # JWT の exp は「その時刻以降は受け付けない」
    assert_token_error("TOKEN_EXPIRED", token_for(), datetime(2026, 9, 5, 13, 0, 0))


def test_extra_wrong_secret_is_invalid():
    token = create_access_token("S001", ISSUED_AT, "another-secret-key-0123456789-abcdef", 3600)
    assert_token_error("TOKEN_INVALID", token, ISSUED_AT)


@pytest.mark.parametrize("token", ["", "abc", "a.b.c"])
def test_extra_malformed_token_is_invalid(token):
    assert_token_error("TOKEN_INVALID", token, ISSUED_AT)


def test_extra_refresh_token_is_not_accepted_as_access_token():
    assert_token_error("TOKEN_INVALID", generate_refresh_token(), ISSUED_AT)


def test_extra_alg_none_is_invalid():
    token = jwt.encode({"sub": "S001", "exp": EXP}, key=None, algorithm="none")
    assert_token_error("TOKEN_INVALID", token, ISSUED_AT)


@pytest.mark.parametrize("payload", [
    pytest.param({"exp": EXP}, id="sub-missing"),
    pytest.param({"sub": "S001"}, id="exp-missing"),
    pytest.param({"sub": "S001", "exp": "not-a-number"}, id="exp-not-int"),
])
def test_extra_token_without_valid_claims_is_invalid(payload):
    token = jwt.encode(payload, SECRET, algorithm="HS256")
    assert_token_error("TOKEN_INVALID", token, ISSUED_AT)


def test_extra_token_issued_in_the_future_of_real_time_is_still_checked_by_token_clock():
    # iat は検証せず、期限だけをトークン用 Clock で判定する
    later = ISSUED_AT + timedelta(days=3650)
    assert verify_access_token(token_for(later), SECRET, later) == "S001"
