# seed.sql の担当者パスワードが Argon2id（既定パラメータ）でハッシュ化されていること
# （design.md 7.1、test_spec.md 3.1）。test_spec.md にケース ID がないため test_extra_ で始める
import re
from pathlib import Path

import pytest
from argon2 import PasswordHasher

SEED_SQL = Path(__file__).resolve().parents[1] / "fixtures" / "seed.sql"

# test_spec.md 3.1 の平文
PLAIN_PASSWORDS = {
    "S001": "ramen-owner-2026",
    "S002": "part-timer-0001",
    "S003": "retired-staff-01",
    "S004": "lock-test-user-1",
}


def _staff_hashes() -> dict[str, str]:
    rows = re.findall(r"\('(S\d{3})',\s*'[^']*',\s*'([^']*)'", SEED_SQL.read_text(encoding="utf-8"))
    return dict(rows)


def test_extra_seed_contains_all_staff():
    assert set(_staff_hashes()) == set(PLAIN_PASSWORDS)


@pytest.mark.parametrize("staff_id", sorted(PLAIN_PASSWORDS))
def test_extra_seed_password_hash_is_argon2id(staff_id):
    password_hash = _staff_hashes()[staff_id]
    assert password_hash.startswith("$argon2id$")
    hasher = PasswordHasher()
    assert hasher.verify(password_hash, PLAIN_PASSWORDS[staff_id])
    # 既定パラメータで作られていれば再ハッシュは不要と判定される
    assert not hasher.check_needs_rehash(password_hash)
