# test_spec.md 5.1.3 IT-34 トランザクション（DB が応答しなくなったとき）
# 手順（test_spec.md v1.3）：docker pause mysql → 購入 → 10秒以上待って応答を確認 → docker unpause mysql
#   → 12秒待って DB を確認 → 同じ内容で再度購入
# test_spec.md では手動のケース。同じ手順を docker コマンドで再現して自動実行する（run_all.sh の 4/4）
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from tests.integration.helpers import count_transactions, fetch_all, login, transaction_body

MYSQL_CONTAINER = "mysql"
# unpause の後、DB を確認するまで待つ秒数（test_spec.md v1.3）。遅れて保存されないことを確かめる
WAIT_AFTER_UNPAUSE_SECONDS = 12


def docker_command() -> str:
    return shutil.which("docker") or str(Path.home() / ".docker" / "bin" / "docker")


@pytest.mark.dbpause
def test_IT_34_db_timeout_returns_500_without_saving_and_retry_succeeds(bff, db):
    docker = docker_command()
    assert login(bff, "S001").status_code == 200
    # 明細は UAT-02（醤油ラーメン1、会員なし。税抜 850・税込 935）。再度の購入でも同じ内容（同じ冪等キー）を送る
    body = transaction_body(items=[{"product_code": "1001", "quantity": 1}], member_id=None, totals=(850, 0, 85, 935))

    subprocess.run([docker, "pause", MYSQL_CONTAINER], check=True, capture_output=True)
    try:
        started = time.monotonic()
        failed = bff.post("/api/transactions", json=body)
        elapsed = time.monotonic() - started
    finally:
        subprocess.run([docker, "unpause", MYSQL_CONTAINER], check=True, capture_output=True)

    # 1回目は約10秒後に 500。BFF の待ち（15秒）を超える前に FastAPI が 500 を返す
    assert failed.status_code == 500, failed.text
    assert failed.json() == {"code": "INTERNAL_ERROR", "message": "処理に失敗しました。もう一度お試しください"}
    assert 10 <= elapsed < 15, f"elapsed={elapsed:.1f}s"

    # unpause の12秒後に DB を確認：取引ヘッダも明細も保存されていない
    time.sleep(WAIT_AFTER_UNPAUSE_SECONDS)
    assert count_transactions(db) == 0
    assert fetch_all(db, "SELECT COUNT(*) AS n FROM transaction_detail")[0]["n"] == 0

    # 2回目は 201 で、取引が1件だけ保存される
    retried = bff.post("/api/transactions", json=body)
    assert retried.status_code == 201, retried.text
    assert retried.json()["total"] == 935
    assert count_transactions(db) == 1
    assert fetch_all(db, "SELECT COUNT(*) AS n FROM transaction_detail")[0]["n"] == 1
