#!/bin/bash
# 結合テスト（test_spec.md 5.1 の自動実行分）を、必要な環境に切り替えながら3回に分けて実行する
#   1/3 通常（.env のとおり。TEST_FIXED_NOW=2026-09-05T12:00:00）：IT-01〜04、06〜20、29〜32、35〜37
#   2/3 ACCESS_TOKEN_TTL_SECONDS=5：IT-05
#   3/3 TEST_FIXED_NOW 未設定（実時刻）：IT-33
# 前提：リポジトリ直下で docker compose up -d 済み。backend/.venv に requirements-dev.txt を導入済み
# 終わったら（途中で失敗しても）backend を .env のとおりの設定に戻す
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

DOCKER="$(command -v docker || echo "$HOME/.docker/bin/docker")"
PYTEST="$REPO_ROOT/backend/.venv/bin/pytest"

wait_for_backend() {
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null http://127.0.0.1:8000/openapi.json; then
      return 0
    fi
    sleep 1
  done
  echo "backend が起動しませんでした" >&2
  exit 1
}

# 引数の環境変数で上書きして backend だけを作り直す（シェルの環境変数は .env より優先される）
restart_backend() {
  env "$@" "$DOCKER" compose up -d --no-deps --force-recreate backend >/dev/null
  wait_for_backend
}

restore_backend() {
  echo "== backend を .env のとおりの設定に戻します"
  restart_backend
}
trap restore_backend EXIT

run_phase() {
  local title="$1" marker="$2"
  shift 2
  echo "== ${title}"
  restart_backend "$@"
  (cd backend && "$PYTEST" tests/integration -m "$marker" -v -p no:cacheprovider)
  return $?
}

status=0
run_phase "1/4 通常（TEST_FIXED_NOW=2026-09-05T12:00:00）" "not ttl5 and not realtime and not dbpause" || status=1
run_phase "2/4 IT-05（ACCESS_TOKEN_TTL_SECONDS=5）" "ttl5" ACCESS_TOKEN_TTL_SECONDS=5 || status=1
run_phase "3/4 IT-33（TEST_FIXED_NOW 未設定）" "realtime" TEST_FIXED_NOW= || status=1
run_phase "4/4 IT-34（docker pause mysql）" "dbpause" || status=1
exit $status
