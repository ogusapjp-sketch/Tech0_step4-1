#!/bin/bash
# アプリ用 DB ユーザーを作成し、DML 権限のみを付与する（design.md 7.5）
# ローカルは MySQL コンテナの初期化時に実行される。Azure では管理者が同等の SQL を手動で実行する
#
# 実行権限を付けて「実行」させる（source させない）。Docker Desktop（macOS）のバインドマウントでは、
# 実行権限のないファイルでも公式イメージの初期化処理が実行可能と判定して実行を試み、失敗するため。
# 別プロセスで動くので docker_process_sql は使えず、初期化中のサーバにソケットで接続する
set -euo pipefail

: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"

# SQL の文字列リテラル用に単引用符を重ねてエスケープする
sql_escape() {
  printf "%s" "${1//\'/\'\'}"
}

APP_USER_SQL=$(sql_escape "$APP_DB_USER")
APP_PASSWORD_SQL=$(sql_escape "$APP_DB_PASSWORD")
DATABASE_IDENT=${MYSQL_DATABASE//\`/\`\`}

# パスワードはコマンドライン引数に出さず、環境変数で渡す
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot <<EOSQL
CREATE USER IF NOT EXISTS '${APP_USER_SQL}'@'%' IDENTIFIED BY '${APP_PASSWORD_SQL}';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DATABASE_IDENT}\`.* TO '${APP_USER_SQL}'@'%';
EOSQL
