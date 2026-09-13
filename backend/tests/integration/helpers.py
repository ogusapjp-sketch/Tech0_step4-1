"""結合テストの共通部品（test_spec.md 5.1）。

起動中の Docker 環境（docker compose up）に対して、BFF（Next.js）経由で httpx から呼び出す。
DB の確認とテストデータの初期化は、アプリ用 DB ユーザー（DML 権限のみ）で MySQL に直接接続して行う。
"""

import os
import uuid
from pathlib import Path

import httpx
import pymysql
import pymysql.cursors
from pymysql.constants import CLIENT

REPO_ROOT = Path(__file__).resolve().parents[3]
SEED_SQL = Path(__file__).resolve().parents[1] / "fixtures" / "seed.sql"

BFF_URL = os.environ.get("IT_BFF_URL", "http://127.0.0.1:3000")
BACKEND_URL = os.environ.get("IT_BACKEND_URL", "http://127.0.0.1:8000")

# test_spec.md 3.1 の平文
PASSWORDS = {
    "S001": "ramen-owner-2026",
    "S002": "part-timer-0001",
    "S003": "retired-staff-01",
    "S004": "lock-test-user-1",
}
WRONG_PASSWORD = "wrong-password-0000"

# UT-B-19 と同じ明細（IT-14〜16）
UT_B_19_ITEMS = [
    {"product_code": "1001", "quantity": 2},
    {"product_code": "2001", "quantity": 3},
    {"product_code": "1004", "quantity": 1},
]
UT_B_19_TOTALS = (2915, 145, 277, 3047)


def load_env() -> dict[str, str]:
    """リポジトリ直下の .env を読み、同名の環境変数があればそちらを優先する。"""
    values: dict[str, str] = {}
    env_file = REPO_ROOT / ".env"
    if env_file.exists():
        for raw in env_file.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    for key in ("APP_DB_USER", "APP_DB_PASSWORD", "MYSQL_DATABASE"):
        if key in os.environ:
            values[key] = os.environ[key]
    return values


ENV = load_env()


def connect_db(multi_statements: bool = False) -> pymysql.connections.Connection:
    return pymysql.connect(
        host=os.environ.get("IT_DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("IT_DB_PORT", "3306")),
        user=ENV.get("APP_DB_USER", "pos_app"),
        password=ENV["APP_DB_PASSWORD"],
        database=ENV.get("MYSQL_DATABASE", "pos"),
        charset="utf8mb4",
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
        client_flag=CLIENT.MULTI_STATEMENTS if multi_statements else 0,
    )


def reseed() -> None:
    """seed.sql を再投入して初期状態に戻す（test_spec.md 3 章）。"""
    sql = SEED_SQL.read_text(encoding="utf-8")
    with connect_db(multi_statements=True) as conn, conn.cursor() as cursor:
        cursor.execute(sql)
        while cursor.nextset():
            pass


def fetch_all(conn: pymysql.connections.Connection, sql: str, args: tuple = ()) -> list[dict]:
    with conn.cursor() as cursor:
        cursor.execute(sql, args)
        return list(cursor.fetchall())


def count_transactions(conn: pymysql.connections.Connection) -> int:
    return fetch_all(conn, "SELECT COUNT(*) AS n FROM `transaction`")[0]["n"]


def login(client: httpx.Client, staff_id: str = "S001", password: str | None = None) -> httpx.Response:
    return client.post(
        "/api/auth/login",
        json={"staff_id": staff_id, "password": PASSWORDS[staff_id] if password is None else password},
    )


def new_key() -> str:
    return str(uuid.uuid4())


def transaction_body(
    items: list[dict] | None = None,
    member_id: str | None = "M000001",
    totals: tuple[int, int, int, int] = UT_B_19_TOTALS,
    key: str | None = None,
) -> dict:
    subtotal, discount_total, tax_amount, total = totals
    return {
        "idempotency_key": key or new_key(),
        "member_id": member_id,
        "items": UT_B_19_ITEMS if items is None else items,
        "client_totals": {
            "subtotal": subtotal,
            "discount_total": discount_total,
            "tax_amount": tax_amount,
            "total": total,
        },
    }


def set_cookies(response: httpx.Response) -> dict[str, str]:
    """Set-Cookie ヘッダを「名前 → ヘッダ文字列」にする。"""
    return {header.split("=", 1)[0]: header for header in response.headers.get_list("set-cookie")}


def has_no_stack_trace(response: httpx.Response) -> bool:
    # Python のトレースバック（Traceback、File "...", line n）を含まないこと
    text = response.text
    return "Traceback" not in text and 'File "' not in text
