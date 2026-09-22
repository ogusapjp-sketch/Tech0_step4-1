# Azure の共有 MySQL に接続するための手順と記録

第12期で共有する Azure Database for MySQL Flexible Server（`gen12-mysql-pos.mysql.database.azure.com`、MySQL 8.4、`require_secure_transport=ON`）に、
自分専用のデータベース `pos_oguchan` を作って接続する。**他の受講生のデータベースには触らない。**

| 項目 | 値 |
|---|---|
| ホスト | `gen12-mysql-pos.mysql.database.azure.com` |
| ポート | 3306 |
| データベース | `pos_oguchan`（自分専用。他は触らない） |
| 管理用ユーザー | `tech0`（共有。DDL とユーザー作成にだけ使う） |
| アプリ用ユーザー | `pos_app_oguchan`（DML のみ。design.md 7.5） |
| SSL | 必須（`require_secure_transport=ON`）。OS の CA でサーバ証明書を検証する |
| サーバの time_zone | `+00:00`（共有サーバのため変更しない）。接続ごとにセッションを `+09:00` にする |

## 1. 接続設定（`.env.azure`）

秘密情報のためコミットしない（`.gitignore` の `.env.*`）。2つに分ける。

| ファイル | 中身 | 渡す先 |
|---|---|---|
| `.env.azure` | アプリ用ユーザー（`DB_USER`・`DB_PASSWORD`）、接続先、SSL、`JWT_SECRET_KEY` など | backend コンテナ（`env_file`）と結合テスト |
| `.env.azure.admin` | 管理用の `ADMIN_DB_USER`・`ADMIN_DB_PASSWORD`（`tech0`） | 人間が手元で実行する DDL・ユーザー管理のみ。コンテナには渡さない |

```
cp .env.azure.example .env.azure
cp .env.azure.admin.example .env.azure.admin
# それぞれ開いてパスワードと JWT_SECRET_KEY を埋める
```

管理用の作業をするときだけ、両方を読み込む。

```
set -a; . ./.env.azure; . ./.env.azure.admin; set +a
```

**書き方の決まり**（docker compose の `env_file` として読ませるため）

- 値は必ず**単引用符 `'…'` で囲む**。`$` や `#` を含むパスワードでも、そのままの文字列として渡る
- 単引用符で囲めば docker compose の変数展開（`${...}`）も行われない
- 値の中に単引用符が含まれる場合だけ `'…'"'"'…'` のように分けて書く
- `=` の前後に空白を入れない。行末に空白やコメントを付けない

### パスワードの扱い（design.md 7、NFR-SEC-10）

- パスワードは `DATABASE_URL` に埋め込まない。`DB_PASSWORD` という別の環境変数から読み、
  `backend/app/core/config.py` の `_build_database_url` が `quote_plus` で URL エンコードしてから接続文字列を組み立てる
  （`@` `:` `/` `#` `%` などを含んでいても壊れない）
- `mysql` クライアントで確認するときも、コマンドの引数に書かず `MYSQL_PWD` 環境変数で渡す（`ps` に出さないため）
- `DB_PASSWORD` がない場合は、これまでどおり `DATABASE_URL` をそのまま使う（ローカルの Docker は変更なし）

## 2. SSL

`DB_SSL_CA='system'` と書くと、OS が持つ CA（`ssl.get_default_verify_paths().cafile`）でサーバ証明書とホスト名を検証して接続する。
Azure の証明書は DigiCert の公開ルートから発行されているため、追加の証明書ファイルは要らない。
CA ファイルを指定したい場合は、そのパスをそのまま書く（例：`/etc/ssl/certs/ca-certificates.crt`）。
backend コンテナ（`python:3.11.16-slim`）で `system` は `/usr/lib/ssl/cert.pem` に解決された。
`mysql` クライアント（`mysql:8.4.11`、Oracle Linux）では `/etc/pki/tls/certs/ca-bundle.crt` を使う。

## 3. タイムゾーン

- サーバの `time_zone` は `+00:00`（共有のため変更しない）
- アプリは日時を必ず `Clock`（日本時間）から作って明示的に書き込むため、サーバの設定に依存しない
- 念のため、接続のたびに `SET SESSION time_zone = '+09:00'` を実行する（`backend/app/db/session.py` の `init_command`。結合テストの DB 接続も同じ）
- **DB 側の `NOW()` / `CURRENT_TIMESTAMP` に依存している箇所はない**（確認結果は「6. 確認した結果」）

## 4. 起動のしかた

ローカルの Docker 一式とはポート（3000・8000）が重なるため、先に止める。

```
docker compose down                                      # ローカルの一式を止める
docker compose -f docker-compose.azure.yml up -d --build # backend と frontend を Azure の DB につないで起動
docker compose -f docker-compose.azure.yml logs -f backend
docker compose -f docker-compose.azure.yml down          # 終了
```

`docker-compose.azure.yml` は MySQL コンテナを持たず、backend に `.env.azure` を `env_file` で渡す。

## 5. 結合テスト（自動分の1回目）を Azure の DB に対して実行する

```
cd backend
IT_ENV_FILE=../.env.azure .venv/bin/pytest tests/integration \
  -m "not ttl5 and not realtime and not dbpause" -v -p no:cacheprovider
```

`IT_ENV_FILE` を指定すると、テストの DB 接続も `.env.azure` の `DB_*`（SSL 込み）を使う。
指定しなければ、これまでどおりローカルの Docker（`.env` の `APP_DB_*`）に接続する。

## 6. 実施した手順（2026-09-22）

`mysql` クライアントは Docker のイメージ（`mysql:8.4.11`）を使い、パスワードは `MYSQL_PWD` で渡す（コマンドの引数に書かない）。
証明書は `--ssl-mode=VERIFY_IDENTITY --ssl-ca=/etc/pki/tls/certs/ca-bundle.crt` で検証する。

```
set -a; . ./.env.azure; . ./.env.azure.admin; set +a

# 1. 接続確認と権限の確認（管理用ユーザー）
docker run --rm -e MYSQL_PWD="$ADMIN_DB_PASSWORD" mysql:8.4.11 \
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$ADMIN_DB_USER" \
  --ssl-mode=VERIFY_IDENTITY --ssl-ca=/etc/pki/tls/certs/ca-bundle.crt \
  -e "SHOW GRANTS FOR CURRENT_USER(); SHOW DATABASES;"

# 2. 自分専用のデータベースを作り、その中だけで schema.sql を実行する
docker run --rm -e MYSQL_PWD="$ADMIN_DB_PASSWORD" mysql:8.4.11 mysql ... \
  -e "CREATE DATABASE IF NOT EXISTS pos_oguchan DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
docker run --rm -i -e MYSQL_PWD="$ADMIN_DB_PASSWORD" mysql:8.4.11 mysql ... -D pos_oguchan \
  < backend/tests/fixtures/schema.sql

# 3. アプリ用ユーザー（DML のみ）を作る。パスワードは引数に出ないよう標準入力から流す
printf "%s\n" "CREATE USER IF NOT EXISTS 'pos_app_oguchan'@'%' IDENTIFIED BY '<生成した値>'; \
  GRANT SELECT, INSERT, UPDATE, DELETE ON pos_oguchan.* TO 'pos_app_oguchan'@'%';" \
  | docker run --rm -i -e MYSQL_PWD="$ADMIN_DB_PASSWORD" mysql:8.4.11 mysql ...

# 4. テストデータを投入する（アプリ用ユーザーで実行し、DML 権限で足りることを確かめる）
docker run --rm -i -e MYSQL_PWD="$DB_PASSWORD" mysql:8.4.11 mysql ... -D pos_oguchan \
  < backend/tests/fixtures/seed.sql
```

## 7. 確認した結果（2026-09-22）

| 確認 | 結果 |
|---|---|
| SSL 接続 | 成功。TLSv1.3（`TLS_AES_128_GCM_SHA256`）。証明書とホスト名の検証（`VERIFY_IDENTITY`）付きで接続できた。`@@require_secure_transport` は 1 |
| サーバ | `8.4.9-azure`。`@@time_zone` は `+00:00` |
| `tech0` の権限 | `SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, RELOAD, PROCESS, REFERENCES, INDEX, ALTER, SHOW DATABASES, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, REPLICATION SLAVE, REPLICATION CLIENT, CREATE VIEW, SHOW VIEW, CREATE ROUTINE, ALTER ROUTINE, CREATE USER, EVENT, TRIGGER, CREATE ROLE, DROP ROLE ON *.* WITH GRANT OPTION`。**CREATE DATABASE も CREATE USER も可能** |
| データベースの作成 | `pos_oguchan` を作成（utf8mb4 / utf8mb4_0900_ai_ci）。他の受講生のデータベース（`apparel_pos`、`bookstore_pos_michishita`、`gu_ec_mako`、`gu_ec_nakaoki`、`pos_app`）には触れていない |
| `schema.sql` | `-D pos_oguchan` を付けて実行し、8テーブルを作成（すべて InnoDB / utf8mb4_0900_ai_ci）。`schema.sql` に `DROP` 文はなく `CREATE TABLE` のみのため、他のデータベースに影響する操作はない |
| アプリ用ユーザー | `pos_app_oguchan`@`%` を作成。権限は `GRANT SELECT, INSERT, UPDATE, DELETE ON pos_oguchan.*` のみ（ほかは `USAGE ON *.*`）。`CREATE TABLE` を試すと `ERROR 1142 CREATE command denied` となり、DDL ができないことを確認した |
| `seed.sql` | アプリ用ユーザーで投入成功。件数は staff 4、member 2、product 12、tax_rate 2、discount_campaign 6、transaction 0 で、ローカルの Docker と同じ |
| セッションのタイムゾーン | アプリの接続で `@@session.time_zone = +09:00`（`@@global.time_zone` は `+00:00` のまま）。`NOW()` は日本時間を返す |
| DB 側の `NOW()` 依存 | **なし**。`schema.sql` に `DEFAULT CURRENT_TIMESTAMP` はなく、`seed.sql` にも `NOW()` はない。アプリも日時はすべて `Clock`（日本時間）から取得して明示的に書き込む。実際に保存された取引の `transacted_at` は `2026-09-05 12:00:00`（`TEST_FIXED_NOW` の値）で、サーバ時刻ではないことを確認した |
| 結合テスト（自動分の1回目） | **26件すべて合格**（`IT_ENV_FILE=../.env.azure`）。ローカルの Docker（MySQL 8.4.11）と同じ結果。所要時間は 53.6秒（ローカルは 2.6秒）で、差はネットワークの往復による |

### design.md との差（記録）

| 項目 | design.md | Azure の検証環境 | 扱い |
|---|---|---|---|
| アプリ用 DB ユーザー名 | `pos_app` | `pos_app_oguchan` | 共有サーバのため、ほかの受講生と名前が衝突しないように変えた。権限（DML のみ）は design.md 7.5 のとおり |
| DDL の実行者 | 管理者権限で `schema.sql` を実行 | `tech0`（共有の管理用ユーザー）で `pos_oguchan` の中だけ実行 | design.md 2.3 のとおり（ずれなし） |
| サーバの time_zone | 全コンテナ・DB とも日本時間 | サーバは `+00:00`（共有のため変更しない）。接続ごとにセッションを `+09:00` にする | 保存する値は日本時間で不変。ずれの影響はない |

## 8. ローカルの Docker に戻す

```
docker compose -f docker-compose.azure.yml down
docker compose up -d
```
