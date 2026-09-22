# CLAUDE.md — 簡易POSアプリ改（Lv2）実装の指示書

このリポジトリは、ラーメン店「唯我独尊」のレジアプリ（簡易POSアプリ改 Lv2）を実装する。
**要件定義書・設計仕様書・テスト仕様書がすべて確定済み**であり、実装はこれらに従う。

## 正となる文書

| 文書 | 役割 | 実装で参照する箇所 |
|---|---|---|
| `design.md`（v1.8） | どう作るか | 2.1 構成、3.3 クラス図、4.2 テーブル定義、5 API、6.1 計算規則・上下限、6.2 エラーコード、6.3 テスト用環境変数、7 セキュリティ |
| `test_spec.md`（v1.3） | どう検証するか | 3 テストデータ、4 単体テストのケース表、4.3 関数シグネチャ・reducer 定義、5 結合テスト |
| `requirements.md`（v1.0） | なぜそうするか | 迷ったときの根拠。3.4 業務ルール |

## 守ること

1. **文書に書かれていることを勝手に変えない。** 設計を変える必要があると判断したら、実装せずに理由と代替案を提示して、人間の判断を待つ。
2. **期待値を推測しない。** テストコードの期待値は `test_spec.md` の表の値をそのまま使う。コード内で計算して期待値を作らない。
3. **文書に書かれていないことは決めずに聞く。** 選択肢を出して人間に決めさせる。「〜と仮定して進めます」は禁止。
4. **テストを先に書く。** 各機能は、テスト仕様書のケースを pytest／jest に写してから実装する。テストが通ることを実装完了の基準とする。
5. **金額計算は整数演算のみ。** 税率は万分率の整数（`tax_rate_bp`）。小数・float を使わない（`design.md` 6.1）。
6. **現在時刻は `Clock` 経由で取得する。** `datetime.now()` / `new Date()` を業務ロジックで直接呼ばない（`design.md` 6.3）。
7. **秘密情報をコミットしない。** DB 接続文字列・JWT 署名鍵は環境変数。`.env` は `.gitignore` に入れる。

## 技術スタック（変更不可）

- フロントエンド：Next.js（App Router）／ TypeScript。Route Handler を BFF として使う
- バックエンド：FastAPI ／ Python 3.11。SQLAlchemy 2.x、Pydantic v2（全スキーマ `extra="forbid"`）、Argon2id（argon2-cffi）
- DB：MySQL 8.4（ローカルは Docker、本番は Azure Database for MySQL Flexible Server）。日時はすべて日本時間（`TZ=Asia/Tokyo`）
- フロントエンド実行環境：Node 24
- テスト：pytest（`--cov=app --cov-branch`）、jest（`--coverage`）。カバレッジ目標 Statements・Branch 80%以上

## ディレクトリ構成

```
backend/
  app/
    main.py            # FastAPI エントリ（create_app）。APP_ENV が production または未設定で docs を無効化
    dependencies.py    # ルータが使う依存関数（アクセストークンの検証、サービスの組み立て）
    core/clock.py      # 業務用 Clock（TEST_FIXED_NOW 対応）とトークン用 Clock（実時刻）
    core/config.py     # 環境変数の読み込み。APP_ENV が未設定なら本番扱い
    core/errors.py     # ErrorResponse とエラーコード（design.md 6.2）、例外ハンドラ
    core/security.py   # JWT 発行・検証、Argon2id
    db/session.py      # SQLAlchemy の接続（単体テストのカバレッジ対象外）
    models/            # SQLAlchemy モデル（design.md 4.2）
    repositories/      # リポジトリの SQLAlchemy 実装（単体テストのカバレッジ対象外。結合テストで確認）
    schemas/           # Pydantic（design.md 5.2 と同名。出力スキーマは responses.py）
    services/
      pricing.py       # PricingService（apply_discount / calculate）
      auth.py          # AuthService（staff_repo, token_repo, business_clock, token_clock, settings を注入）
      transaction.py   # TransactionService（verify_client_totals / confirm）
    routers/           # auth, settings, members, products, transactions
  db/init_app_user.sh  # アプリ用 DB ユーザー（DML 権限のみ）の作成。MySQL コンテナの初期化時に実行
  tests/
    unit/              # test_spec.md 4.1 のケース（UT-B-nn をテスト名に含める）
    integration/       # test_spec.md 5.1 のケース（IT-nn）。Docker 起動後に httpx で実行
    fixtures/schema.sql  # DDL（管理者権限で実行）
    fixtures/seed.sql    # test_spec.md 3 のテストデータ（先頭で全テーブルを空にする）
frontend/
  src/lib/pricing.ts        # calcTotals
  src/lib/classifyCode.ts   # classifyCode
  src/lib/cartReducer.ts    # cartReducer（test_spec.md 4.3 の state / action）
  src/app/api/              # BFF Route Handler（Cookie ↔ Authorization ヘッダの詰め替え）
  __tests__/                # test_spec.md 4.2 のケース（UT-F-nn をテスト名に含める）
docker-compose.yml          # Next.js / FastAPI / MySQL
docs/dependencies.md        # 採用パッケージのバージョンと脆弱性確認の記録（design.md 7.6）
```

## 実装の順序

1. `docker-compose.yml`、`backend/tests/fixtures/seed.sql`、`Clock`
2. `PricingService` と単体テスト UT-B-01〜32、UT-B-87
3. `calcTotals` と UT-F-01〜09（バックエンドと同じ期待値で一致を確認）
4. Pydantic スキーマと UT-B-33〜64、86
5. `AuthService` と UT-B-65〜79
6. `TransactionService` と UT-B-80〜85
7. `classifyCode`、`cartReducer` と UT-F-10〜34
8. API ルータ、BFF、画面
9. 結合テスト IT-01〜37（Docker 起動後）
10. CI（pip-audit／npm audit）と Dependabot の設定、`docs/dependencies.md` の確定

各段階でテストを実行し、通ってから次へ進む。1段階ごとにコミットする。

## テストの書き方

- テスト関数名にケース ID を含める（例：`test_UT_B_08_percent_rounding_per_unit`）。仕様書にケース ID がないテストは `test_extra_` で始める
- `parametrize` に `test_spec.md` の表の値をそのまま写す
- 単体テストは DB を使わない。`AuthService` はインメモリの偽リポジトリと固定 `Clock` を注入する。ロック判定は業務用 Clock、JWT・リフレッシュトークンの期限はトークン用 Clock（実時刻）で判定する
- 結合テストは `docker compose up` した環境に対して httpx で実行する

## Git の運用

main に直接コミットし、段階ごとに push する。コミットメッセージは `step2: PricingService と UT-B-01〜32` のように段階番号で始める。

## パッケージの選定

具体的なバージョンは Claude Code が調べて `docs/dependencies.md` の案として提示し、人間が承認してから採用する（design.md 7.6）。`package-lock.json` と `requirements.txt`（`==` 固定）で固定する。

## 環境に関する注意

- この Mac には Anaconda（`base` 環境）が入っているが、**バックエンドは `backend/.venv` に専用の仮想環境を作って使う**。`python3 -m venv backend/.venv` で作成し、`backend/.venv/bin/pip` と `backend/.venv/bin/pytest` を使う。conda の環境にはパッケージを入れない
- `.venv/` と `node_modules/` は `.gitignore` に入れる
- 段階8f 以降は Docker の起動が前提（画面の確認・結合テスト・手動テスト）。リポジトリ直下で `docker compose up -d` を実行する。`.env` は `.env.example` から作り、ローカルでは `APP_ENV=development`、`TEST_FIXED_NOW=2026-09-05T12:00:00` にする
- Mac の再起動後などで Docker Desktop が止まっていると `docker compose` は失敗する。先に Docker Desktop を起動する。`docker` コマンドが PATH にない場合は `~/.docker/bin/docker` を使う
- 結合テストは `backend/tests/integration/run_all.sh` で実行する（手順は `docs/integration_test.md`）。コードを変えたら `docker compose up -d --build` でイメージを作り直してから実行する
