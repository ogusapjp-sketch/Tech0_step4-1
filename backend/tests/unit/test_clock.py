# design.md 6.3 の Clock。test_spec.md にケース ID がないため test_extra_ で始める
# APP_ENV が未設定・空のときは本番扱いにする（人間が決定。設定漏れで安全側に倒す）
from datetime import datetime, timedelta, timezone

import pytest

from app.core.clock import (
    FixedClock,
    SystemClock,
    get_business_clock,
    get_token_clock,
)

DEV = {"APP_ENV": "development"}


def _real_jst_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=9)


def test_extra_system_clock_returns_jst_without_tzinfo():
    now = SystemClock().now()
    assert now.tzinfo is None
    assert abs(now - _real_jst_now()) < timedelta(seconds=5)


def test_extra_business_clock_uses_test_fixed_now():
    clock = get_business_clock({**DEV, "TEST_FIXED_NOW": "2026-09-07T21:59:00"})
    assert clock.now() == datetime(2026, 9, 7, 21, 59, 0)


def test_extra_business_clock_fixed_value_does_not_advance():
    clock = get_business_clock({**DEV, "TEST_FIXED_NOW": "2026-09-05T00:00:00"})
    assert clock.now() == clock.now() == datetime(2026, 9, 5, 0, 0, 0)


def test_extra_business_clock_without_test_fixed_now_is_real_time():
    clock = get_business_clock(DEV)
    assert isinstance(clock, SystemClock)


def test_extra_business_clock_empty_test_fixed_now_is_real_time():
    clock = get_business_clock({**DEV, "TEST_FIXED_NOW": ""})
    assert isinstance(clock, SystemClock)


def test_extra_business_clock_ignores_test_fixed_now_in_production():
    clock = get_business_clock(
        {"APP_ENV": "production", "TEST_FIXED_NOW": "2026-09-05T00:00:00"}
    )
    assert isinstance(clock, SystemClock)


@pytest.mark.parametrize("env", [
    pytest.param({"TEST_FIXED_NOW": "2026-09-05T00:00:00"}, id="app-env-unset"),
    pytest.param({"APP_ENV": "", "TEST_FIXED_NOW": "2026-09-05T00:00:00"}, id="app-env-empty"),
])
def test_extra_business_clock_ignores_test_fixed_now_when_app_env_unset(env):
    assert isinstance(get_business_clock(env), SystemClock)


def test_extra_business_clock_honors_test_fixed_now_outside_production():
    clock = get_business_clock({**DEV, "TEST_FIXED_NOW": "2026-09-05T00:00:00"})
    assert clock.now() == datetime(2026, 9, 5, 0, 0, 0)


def test_extra_test_fixed_now_with_offset_is_converted_to_jst():
    clock = get_business_clock({**DEV, "TEST_FIXED_NOW": "2026-09-07T12:59:00+00:00"})
    now = clock.now()
    assert now == datetime(2026, 9, 7, 21, 59, 0)
    assert now.tzinfo is None


def test_extra_test_fixed_now_invalid_format_raises():
    with pytest.raises(ValueError):
        get_business_clock({**DEV, "TEST_FIXED_NOW": "not-a-datetime"})


def test_extra_business_clock_reads_os_environ_by_default(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("TEST_FIXED_NOW", "2026-09-05T12:00:00")
    assert get_business_clock().now() == datetime(2026, 9, 5, 12, 0, 0)


def test_extra_token_clock_ignores_test_fixed_now(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("TEST_FIXED_NOW", "2026-09-05T00:00:00")
    clock = get_token_clock()
    assert isinstance(clock, SystemClock)
    assert abs(clock.now() - _real_jst_now()) < timedelta(seconds=5)


def test_extra_fixed_clock_returns_given_value():
    fixed = datetime(2026, 9, 1, 0, 0, 0)
    assert FixedClock(fixed).now() == fixed
