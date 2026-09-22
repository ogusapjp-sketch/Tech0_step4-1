# テスト結果の記録

test_spec.md の結果欄には記入せず、実施結果を本書に記録する。

## 現時点の検証状況（2026-09-14、段階10 完了時点）

| テストレベル | 対象 | 状況 | 結果・根拠 |
|---|---|---|---|
| 単体テスト（UT） | UT-B-01〜87（87件）、UT-F-01〜41（41件） | **完了** | 全ケース合格。test_spec.md のケース ID はすべてテストコードに含まれる。pytest 247件・jest 191件（ケース ID のない `test_extra_` を含む）がすべて合格。カバレッジはバックエンド Statements 100%・Branch 100%（DB 接続・リポジトリは対象外。test_spec.md 2.5）、フロントエンド Statements 99.52%・Branch 97.30%。CI #11（`9ca6e52`）で合格 |
| 結合テスト（IT） | IT-01〜37（37件） | **完了** | 合格（自動28、手動9）。次章 |
| 機能テスト（ST） | ST-01〜41（40件。ST-19 は欠番） | **未実施** | — |
| ユーザーテスト（UAT） | UAT-01〜18（18件） | **未実施** | — |

### MySQL 8.4 への変更にともなう再実行（2026-09-22）

ローカルの MySQL を Azure の検証環境に合わせて 8.0.46 から `mysql:8.4.11` に変更し、次を再実行して 8.0 と同じ結果になることを確認した（design.md v1.5）。

| 対象 | 結果 |
|---|---|
| schema.sql・seed.sql の投入（`docker compose down -v` から作り直し） | 成功。テストデータの件数は 8.0 と同じ |
| 単体テスト（pytest 247件、jest 191件） | 合格。カバレッジもバックエンド 100%／100%、フロント 99.52%／97.30% で変化なし |
| 結合テストの自動分（IT-01〜20、29〜37 の28件。`run_all.sh` の全4回） | 合格 |
| 手動分（IT-21〜28 の8件） | 8.4 では再実施していない（2026-09-14 の 8.0 での結果を維持） |

### 未実施のテスト

- **機能テスト（ST）**：test_spec.md 5.2・5.3 のとおり、要件（FR・NFR）単位で実施する。環境の指定があるもののうち、ST-28（3時間放置後の応答）、ST-37（Cookie の Secure 属性）、ST-39（本番設定での Swagger Docs の非表示）、ST-40（外部から FastAPI に到達できないこと）は Azure 検証環境が必要
- **ユーザーテスト（UAT）**：test_spec.md 2.4・6 章のとおり、Azure 検証環境（本番同等構成）で、店舗の端末・カメラ、印刷したメニュー早見表・会員証（Code128）を使って実施する
- **Azure 検証環境**：design.md 2.3 の構成（Container Apps、内部 Ingress、Azure Database for MySQL Flexible Server）は段階1〜10 の範囲外で、未構築

---

## 結合テスト（test_spec.md 5.1）

| 項目 | 内容 |
|---|---|
| 対象 | IT-01〜37 |
| 結果 | **IT-01〜37 合格（自動28、手動9）** |
| 実施日 | 2026-09-14 |
| 環境 | ローカル Docker（`docker compose up`）：Next.js 16.3.5、FastAPI 0.141.1、MySQL 8.0.46（2026-09-22 に MySQL 8.4.11 で自動28件を再実行し、同じ結果で合格。前章）。`APP_ENV=development`、`TEST_FIXED_NOW=2026-09-05T12:00:00` |
| 手順 | `docs/integration_test.md` |

### 内訳

| 区分 | ケース | 件数 | 方法 | 結果 |
|---|---|---|---|---|
| 自動 | IT-01〜20 | 20 | `backend/tests/integration/run_all.sh`（IT-05 は `ACCESS_TOKEN_TTL_SECONDS=5` で起動した環境） | 合格 |
| 自動 | IT-29〜33 | 5 | 同上（IT-33 は `TEST_FIXED_NOW` 未設定で起動した環境） | 合格 |
| 自動 | IT-35〜37 | 3 | 同上 | 合格 |
| 手動 | IT-21〜28 | 8 | ブラウザでの画面操作と DB の参照（`docs/integration_test.md` 3.2） | 合格 |
| 手動 | IT-34 | 1 | `docker pause mysql` による DB 無応答の再現（`docs/integration_test.md` 3.3）。同じ手順の自動テスト（`run_all.sh` の 4/4）でも合格 | 合格 |
| **合計** | | **37**（自動28、手動9） | | **合格** |

### 実施中に見つかり、修正した不具合・仕様の補足

| 内容 | 対応 |
|---|---|
| Docker Desktop（macOS）で MySQL 初期化時のアプリ用ユーザー作成が失敗し、コンテナが停止した | `backend/db/init_app_user.sh` を実行権限付きで別プロセス実行する形に修正（段階8f） |
| IT-34：`docker pause mysql` の間、購入のリクエストが待ち続け、再開後に保存された | DB の読み書きタイムアウト10秒、BFF のタイムアウト15秒を導入。`pool_pre_ping` を使わず接続を240秒で入れ替える（段階9、design.md v1.4 6.2・2.3、test_spec.md v1.3 IT-34） |

---

## 段階1〜10 の振り返り

### 段階ごとの成果と検証

| 段階 | 内容 | 検証 | コミット |
|---|---|---|---|
| 1 | docker-compose、schema.sql、seed.sql、Clock | Clock の切り替えと seed.sql の Argon2id ハッシュを `test_extra_` で確認 | `e1140dd` |
| 2 | PricingService | UT-B-01〜32、UT-B-87 | `421a1fb` |
| 3 | calcTotals | UT-F-01〜09（バックエンドと同じ期待値） | `e30542a` |
| 4 | Pydantic スキーマ | UT-B-33〜64、UT-B-86 | `08179de` |
| 5 | AuthService | UT-B-65〜79 | `075d9f4` |
| 6 | TransactionService（金額の照合） | UT-B-80〜85 | `28b4009` |
| 7 | classifyCode、cartReducer | UT-F-10〜34 | `e00ce28` |
| 8a〜8e | バックエンドの土台、API ルータと購入確定、backend Dockerfile、BFF・proxy.ts・セキュリティヘッダ、画面・frontend Dockerfile | UT-F-35〜41。ルータ・BFF・proxy・画面の操作を `test_extra_` で確認。各 Docker イメージの起動を確認 | `5615f9b`、`34fe5ce`、`5e6eb11`、`9de1e4a`、`7e8dd52`、`6bddd44` |
| 8f | Docker で通しの確認 | Next.js 経由でログイン → 会員 → 商品 → 購入、DB の保存を確認。人間がブラウザで確認 | `b344941` |
| 9 | 結合テスト、DB タイムアウト | IT-01〜37 | `1b59d74`、`d575273` |
| 10 | CI、Dependabot、依存パッケージの最終版 | CI（単体テスト・カバレッジ・型チェック・本番ビルド・脆弱性検査）が合格 | `487feca`、`ee76642`、`9ca6e52` |

### 文書に反映した事項

| 時期 | 内容 | 反映先 |
|---|---|---|
| 着手前 | 文書の不明点・食い違い18件を指摘し、人間が判断 | design.md v1.3、test_spec.md v1.2 |
| 段階5 | AuthService に業務用・トークン用の2つの Clock を注入する | CLAUDE.md、test_spec.md 4.3 |
| 段階8a〜9 | APP_ENV 未設定は本番扱い、Cookie の名前・有効期間、CSP の nonce 方式と追加のセキュリティヘッダ、担当者名の表示用 Cookie、冪等キーの作り直し規則、DB と BFF のタイムアウト、カバレッジの対象外 | design.md v1.4、test_spec.md v1.3 |
| 段階10 | CI の失敗条件（pip-audit は既知の脆弱性1件で失敗、カバレッジ80%）、Dependabot の無視・グループ設定、pydantic を更新するときの運用、閉じた更新 PR #1〜#4 | docs/dependencies.md |

### 残っている確認事項

| 内容 | 状況 |
|---|---|
| 機能テスト（ST-01〜41）とユーザーテスト（UAT-01〜18） | 未実施。Azure 検証環境の構築が前提（ST の一部と UAT） |
| 接続の入れ替え（240秒）が、長時間の放置後の切断に対して有効か | ST-28（Azure で3時間放置）で確認する |
| GitHub の Settings → Code security の「Dependabot alerts」「Dependabot security updates」 | 有効化の状態は未確認（design.md 7.6 の「脆弱性の検出時に更新 PR を自動生成」に必要） |
| FastAPI の TestClient が出す `httpx2` の非推奨警告 | テストの動作には影響しない。`httpx2` は未承認のため `httpx` を継続 |
