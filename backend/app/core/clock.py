"""現在時刻の取得を集約する（design.md 6.3）。

- 業務用 Clock：期間判定・取引日時・ロック解除判定に使う。TEST_FIXED_NOW に対応
- トークン用 Clock：JWT の発行・検証に使う。常に実時刻

日時はすべて日本時間で、タイムゾーン情報を持たない値として扱う（design.md 2.3）。
"""

import os
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Protocol

# 日本は夏時間がないため固定オフセットで表せる
JST = timezone(timedelta(hours=9), "JST")


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    """実時刻を日本時間（タイムゾーン情報なし）で返す。"""

    def now(self) -> datetime:
        return datetime.now(JST).replace(tzinfo=None)


class FixedClock:
    """常に同じ日時を返す。"""

    def __init__(self, fixed: datetime) -> None:
        self._fixed = fixed

    def now(self) -> datetime:
        return self._fixed


def _parse_fixed_now(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(JST).replace(tzinfo=None)
    # タイムゾーン指定がない場合は日本時間とみなす
    return parsed


def get_business_clock(env: Mapping[str, str] | None = None) -> Clock:
    """業務用 Clock。本番では TEST_FIXED_NOW を無視する。

    APP_ENV が未設定・空のときも本番扱いにする（設定漏れで安全側に倒す。core/config.py と同じ判定）。
    """
    env = os.environ if env is None else env
    if (env.get("APP_ENV") or "production") == "production":
        return SystemClock()
    fixed_now = env.get("TEST_FIXED_NOW")
    if not fixed_now:
        return SystemClock()
    return FixedClock(_parse_fixed_now(fixed_now))


def get_token_clock() -> Clock:
    """トークン用 Clock。TEST_FIXED_NOW の影響を受けない。"""
    return SystemClock()
