# 結合テスト手順書（test_spec.md 5.1）

test_spec.md 5.1 の結合テスト（IT-01〜37）の実施方法。自動実行できるケースは pytest＋httpx で実行し、画面操作が必要なケースは手動で実施する。

| 区分 | ケース | 方法 |
|---|---|---|
| 自動 | IT-01〜20、IT-29〜33、IT-35〜37 | `backend/tests/integration/`（第2章） |
| 自動＋手動 | IT-34 | API での再現は自動（第2章の 4/4）。画面での確認は手動（3.3） |
| 手動 | IT-21〜28 | ブラウザと DB の参照（第3章） |

---

## 1. 前提

### 1.1 環境の起動

リポジトリ直下で実行する。

```bash
cp .env.example .env        # 初回のみ。パスワード類をローカル用の値にする
docker compose up -d --build
docker compose ps           # mysql が healthy、backend・frontend が running
```

`.env` は次の設定にする（基準日の固定は test_spec.md 3 章）。

| 変数 | 値 |
|---|---|
| `APP_ENV` | `development` |
| `TEST_FIXED_NOW` | `2026-09-05T12:00:00`（企画1〜3・5 が有効な日） |
| `ACCESS_TOKEN_TTL_SECONDS` | `3600` |

`docker` コマンドが見つからない場合は `~/.docker/bin/docker` を使う。

### 1.2 テストデータの初期化

ロックや取引の蓄積が後続に影響するため、ケースごとに初期状態へ戻す（test_spec.md 3 章）。自動テストは各テストの前に自動で実行する。手動では次を実行する。

```bash
docker exec -i mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot pos' < backend/tests/fixtures/seed.sql
```

### 1.3 DB の参照（手動ケースの確認用）

```bash
docker exec mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -t pos -e "
SELECT transaction_id, transacted_at, staff_id, member_id, subtotal, discount_total, tax_amount, total FROM \`transaction\` ORDER BY transaction_id;
SELECT transaction_id, line_no, product_code, product_name, unit_price, quantity, discount_amount FROM transaction_detail ORDER BY transaction_id, line_no;"'
```

---

## 2. 自動実行（IT-01〜20、IT-29〜37）

### 2.1 一括実行

IT-05 と IT-33 は backend の起動時の設定を変える必要があり、IT-34 は MySQL を一時停止するため、スクリプトが backend だけを作り直しながら4回に分けて実行する。終了時（失敗時も）は backend を `.env` のとおりに戻す。

```bash
backend/tests/integration/run_all.sh
```

| 回 | backend の設定 | 対象 | pytest のマーカー |
|---|---|---|---|
| 1/4 | `.env` のとおり | IT-01〜04、06〜20、29〜32、35〜37 | `not ttl5 and not realtime and not dbpause` |
| 2/4 | `ACCESS_TOKEN_TTL_SECONDS=5` | IT-05 | `ttl5` |
| 3/4 | `TEST_FIXED_NOW` 未設定（実時刻） | IT-33 | `realtime` |
| 4/4 | `.env` のとおり（テスト中に `docker pause mysql`） | IT-34 | `dbpause` |

### 2.2 個別に実行する場合

シェルの環境変数は `.env` より優先されるため、変数を付けて backend だけを作り直す。

```bash
# 1/4 通常
cd backend && .venv/bin/pytest tests/integration -m "not ttl5 and not realtime and not dbpause" -v && cd ..

# 2/4 IT-05：アクセストークンの有効期間を5秒にして起動
ACCESS_TOKEN_TTL_SECONDS=5 docker compose up -d --no-deps --force-recreate backend
cd backend && .venv/bin/pytest tests/integration -m ttl5 -v && cd ..

# 3/4 IT-33：TEST_FIXED_NOW を未設定にして起動
TEST_FIXED_NOW= docker compose up -d --no-deps --force-recreate backend
cd backend && .venv/bin/pytest tests/integration -m realtime -v && cd ..

# 元に戻す（.env のとおり）
docker compose up -d --no-deps --force-recreate backend

# 4/4 IT-34：MySQL を一時停止する。他のテストと同時に実行しない
cd backend && .venv/bin/pytest tests/integration -m dbpause -v && cd ..
```

### 2.3 仕組み

- 呼び出し先は BFF（`http://127.0.0.1:3000/api/...`）。IT-35 は FastAPI（`http://127.0.0.1:8000`）も確認する
- DB の確認とデータの初期化は、アプリ用 DB ユーザー（DML 権限のみ）で `127.0.0.1:3306` に接続する。接続情報は `.env` から読む
- 期待値は test_spec.md の表の値。IT-14〜16 は UT-B-19 と同じ明細（醤油850×2＋味玉120×3＋特製855×1、会員 M000001）。IT-19・IT-33 は UT-B-18（醤油850×2、会員なし）、IT-34 は UAT-02（醤油1、会員なし）の明細を使う

---

## 3. 手動実施（IT-21〜28、IT-34）

### 3.1 共通の準備

1. 第1章の環境で実施する（`TEST_FIXED_NOW=2026-09-05T12:00:00`）
2. ケースごとに 1.2 のテストデータ初期化を実行する
3. ブラウザのシークレットウィンドウで **http://localhost:3000** を開く（前のケースの Cookie を残さないため。ケースごとに開き直す）
4. 商品の手入力は2段階：商品コード欄に入力 →「照会」→ 名称・単価が表示される →「追加」
5. カメラで試す場合は `docs/barcodes_test_data.pdf`（テストデータのバーコード早見表）を印刷する

ログイン情報（test_spec.md 3.1）：S001／`ramen-owner-2026`、S002／`part-timer-0001`

### 3.2 状態遷移（IT-21〜28）

#### IT-21 基本の流れ

| 手順 | 操作 | 確認点 |
|---|---|---|
| 1 | http://localhost:3000 を開く | ログイン画面に移る |
| 2 | S001 でログイン | レジ画面に移り、「担当者：店主」 |
| 3 | 会員ID `M000001` →「会員読込」 | 「山田太郎（M000001）割引対象」 |
| 4 | 商品 `1002`（味噌ラーメン）を照会・追加 | 購入リストに1行 |
| 5 | 商品 `2001`（味玉）を照会・追加 | 購入リストに2行 |
| 6 | 「購入」 | ポップアップに税込合計 |
| 7 | 「閉じる」 | 購入リスト・会員欄（「会員なし」）・入力欄が空になる |

**期待値（test_spec.md）**：各画面が順に遷移し、最後にリスト・会員欄が空になる。参考：同じ明細の UAT-03 は税抜 1,020・値引き 20・税込 1,100。

#### IT-22 会員が後

| 手順 | 操作 | 確認点 |
|---|---|---|
| 1 | S001 でログイン | レジ画面 |
| 2 | 商品 `1002`、`2001` を照会・追加 | 味玉の行の値引きは「0」 |
| 3 | 会員ID `M000001` →「会員読込」 | **この時点で**味玉の行に「−20」が表示される |
| 4 | 合計を確認 | 税抜 1,020円・値引き合計 20円・税込 1,100円（UAT-03・04 の値） |
| 5 | 「購入」 | ポップアップの税込合計が 1,100円 |
| 6 | 1.3 で DB を参照 | 最新の取引が discount_total 20、total 1100、member_id M000001 |

**期待値（test_spec.md）**：会員読込の時点で値引き額が表示され、購入時の金額に反映される。

#### IT-23 会員なし

| 手順 | 操作 | 確認点 |
|---|---|---|
| 1 | S001 でログイン | レジ画面 |
| 2 | 商品 `1001`（醤油ラーメン）を照会・追加 | 購入リストに1行 |
| 3 | 「会員なし」 | 会員欄が「会員なし」 |
| 4 | 合計を確認 | 税抜 850円・値引き合計 0円・税込 935円（UAT-02 の値） |
| 5 | 「購入」 | エラーにならず、ポップアップの税込合計が 935円 |
| 6 | 1.3 で DB を参照 | 最新の取引の member_id が NULL、discount_total 0 |

**期待値（test_spec.md）**：エラーにならず確定。値引きなし。

#### IT-24 編集を挟む

| 手順 | 操作 | 確認点 |
|---|---|---|
| 1 | S001 でログイン | レジ画面 |
| 2 | 商品 `1001`、`3001`（餃子）、`4001`（瓶ビール）を照会・追加 | 購入リストに3行 |
| 3 | 2行目（餃子）を押す | 餃子の行が強調表示され、「選択中の商品」に餃子・400円・数量 1 |
| 4 | 「削除」 | 餃子の行が消え、「商品を選択してください」 |
| 5 | 1行目（醤油ラーメン）を押し、「変更する数量」を `3` →「数量を変更」 | 醤油ラーメンの行の数量が 3 になり、合計が変わる |
| 6 | 画面の税込合計を控える →「購入」 | ポップアップの税込合計が控えた値と同じ |
| 7 | 1.3 で DB を参照 | 最新の取引の明細が「1001 数量3」「4001 数量1」の2行で、3001 がない。total が控えた値と同じ |

**期待値（test_spec.md）**：合計が編集後の内容で確定する。

#### IT-25 空で購入

| 手順 | 操作 | 確認点 |
|---|---|---|
| 1 | S001 でログイン | レジ画面。購入リストは空 |
| 2 | 「購入」を押そうとする | ボタンが無効（押せない）。ポップアップが出ない |
| 3 | 1.3 で DB を参照 | 取引が増えていない |

**期待値（test_spec.md）**：確定しない。リストは空のまま。

#### IT-26 連続会計

| 手順 | 操作 | 確認点 |
|---|---|---|
| 1 | S001 でログイン | レジ画面 |
| 2 | 1件目：商品 `1001` を照会・追加 →「会員なし」→「購入」→「閉じる」 | 画面が空になる |
| 3 | 2件目：会員ID `M000002` →「会員読込」 | 「鈴木花子（M000002）割引対象」 |
| 4 | 商品 `1002` を照会・追加 | 購入リストが味噌ラーメンの1行だけ（1件目の醤油ラーメンがない） |
| 5 | 「購入」→「閉じる」 | 確定する |
| 6 | 1.3 で DB を参照 | 取引が2件。1件目：member_id NULL、明細 1001 のみ。2件目：member_id M000002、明細 1002 のみ |

**期待値（test_spec.md）**：2件目が1件目の内容を引き継がずに確定する。

#### IT-27 未登録を挟む

| 手順 | 操作 | 確認点 |
|---|---|---|
| 1 | S001 でログイン | レジ画面 |
| 2 | 商品 `1001` を照会・追加 | 購入リストに1行 |
| 3 | 商品コード `9999` →「照会」 | 「商品がマスタ未登録です」。醤油ラーメンの行は残っている |
| 4 | 商品 `2001` を照会・追加 | エラー表示が消え、購入リストが2行 |

**期待値（test_spec.md）**：未登録のエラー後も、リストは保持され続行できる。

#### IT-28 ログイン失敗から復帰

| 手順 | 操作 | 確認点 |
|---|---|---|
| 1 | http://localhost:3000/login で担当者ID `S001`、パスワード `wrong-password-0000` →「ログイン」 | 「担当者IDまたはパスワードが正しくありません」。ログイン画面のまま。パスワード欄が空になる |
| 2 | パスワード `ramen-owner-2026` →「ログイン」 | レジ画面に移り、「担当者：店主」 |

**期待値（test_spec.md）**：2回目でレジ画面へ遷移。

### 3.3 外部連携（IT-34）

DB が応答しなくなったときに、確定していないのに確定扱いになる・二重に確定される、が起きないこと（NFR-OPS-05）を確認する。

#### 前提となる設定（人間が決定）

| 対象 | 設定 | 超えたとき |
|---|---|---|
| FastAPI の DB 接続 | 読み書きのタイムアウト 10秒（`backend/app/db/session.py`） | 500 INTERNAL_ERROR。トランザクションはロールバック |
| FastAPI の DB 接続 | 使う前の接続確認（pool_pre_ping）はしない。接続は240秒で入れ替える | — |
| BFF が FastAPI を待つ時間 | 15秒（`frontend/src/lib/server/bff.ts`） | 500 INTERNAL_ERROR |
| 画面 | 500 を受けたら「処理に失敗しました。もう一度お試しください」を表示し、購入リストを保持 | — |

#### 手順

| 手順 | 操作 | 確認点 |
|---|---|---|
| 1 | 1.2 で初期化し、S001 でログイン | レジ画面 |
| 2 | 商品 `1001` を照会・追加し、「会員なし」 | 購入リストに1行。税込 935円（UAT-02 の値） |
| 3 | ターミナルで `docker pause mysql` | — |
| 4 | 「購入」を押し、**10秒以上待つ** | 約10秒後に「処理に失敗しました。もう一度お試しください」。ポップアップは出ない。購入リストが残っている |
| 5 | ターミナルで `docker unpause mysql` → **12秒待って** 1.3 で DB を参照 | 取引ヘッダも明細も増えていない |
| 6 | 同じ内容のまま、もう一度「購入」 | ポップアップに税込合計 935円 |
| 7 | 1.3 で DB を参照 | 取引が1件だけ（ヘッダ1件・明細1件） |

手順6は購入リストと会員を変えずに押す。同じ冪等キーで再送される（変えると新しいキーになる）。

**期待値（test_spec.md v1.3）**：1回目は 500（約10秒後）で「処理に失敗しました」。unpause 後も取引は保存されない。2回目は 201 で取引が1件だけ保存される。

#### 確認結果（2026-09-14、段階9）

同じ手順を BFF 経由の API で実行した。自動テスト（2.1 の 4/4）も合格。

| 手順 | 結果 |
|---|---|
| `docker pause mysql` → `POST /api/transactions` | **500 INTERNAL_ERROR（10.0秒）**。FastAPI のログは `OperationalError (2013, 'Lost connection to MySQL server during query (The read operation timed out)')` |
| `docker unpause mysql` の12秒後に DB を参照 | 取引ヘッダ 0件・明細 0件（再開後に保存されない） |
| 同じ冪等キー・同じ内容で再度 `POST /api/transactions` | **201**（0.03秒） |
| DB を参照 | 取引ヘッダ 1件・明細 1件 |

#### 経緯

- タイムアウトなし：一時停止中はリクエストが待ち続け、再開後に 201 で保存された（test_spec.md の期待値にならない）
- 読み書き10秒＋pool_pre_ping：FastAPI は「接続確認の待ち10秒＋張り直しの応答待ち10秒」で 20秒後に 500。BFF が15秒で 500 を返した後に再開すると、FastAPI の処理が進んで保存された。PyMySQL は張り直しの応答待ちにも読み取りのタイムアウトを使うため、接続のタイムアウトでは短縮できない
- pool_pre_ping をやめた（人間が決定）：FastAPI が10秒で 500 を返し、処理が残らなくなった
