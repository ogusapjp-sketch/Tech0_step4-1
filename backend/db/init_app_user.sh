#!/bin/bash
# アプリ用 DB ユーザーを作成し、DML 権限のみを付与する（design.md 7.5）
# ローカルは MySQL コンテナの初期化時に実行される。Azure では管理者が同等の SQL を手動で実行する
# 公式イメージの初期化処理から source されるため、docker_process_sql が使える
set -euo pipefail

: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"

docker_process_sql --database=mysql <<-EOSQL
	CREATE USER IF NOT EXISTS '${APP_DB_USER}'@'%' IDENTIFIED BY '${APP_DB_PASSWORD}';
	GRANT SELECT, INSERT, UPDATE, DELETE ON \`${MYSQL_DATABASE}\`.* TO '${APP_DB_USER}'@'%';
EOSQL
