"""結合テストの前提（test_spec.md 5.1）。起動中の Docker 環境に対して実行する。"""

import httpx
import pytest

from tests.integration.helpers import BFF_URL, connect_db, reseed


@pytest.fixture(scope="session", autouse=True)
def stack_is_running() -> None:
    try:
        response = httpx.get(f"{BFF_URL}/login", timeout=10)
    except httpx.HTTPError as exc:
        pytest.exit(f"Docker 環境（{BFF_URL}）に接続できません。docker compose up -d を実行してください：{exc}", returncode=2)
    if response.status_code != 200:
        pytest.exit(f"{BFF_URL}/login が {response.status_code} を返しました。Docker 環境を確認してください", returncode=2)


@pytest.fixture(autouse=True)
def reset_data() -> None:
    # ロックや取引の蓄積が後続に影響するため、各テストの前に初期状態へ戻す（test_spec.md 3 章）
    reseed()


@pytest.fixture
def bff():
    # テストごとに新しい Cookie の保管場所を使う（ブラウザを開き直すのと同じ）
    with httpx.Client(base_url=BFF_URL, timeout=30) as client:
        yield client


@pytest.fixture
def db():
    with connect_db() as conn:
        yield conn
