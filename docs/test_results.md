# テスト結果の記録

test_spec.md の結果欄には記入せず、実施結果を本書に記録する。

## 結合テスト（test_spec.md 5.1）

| 項目 | 内容 |
|---|---|
| 対象 | IT-01〜37 |
| 結果 | **IT-01〜37 合格（自動28、手動9）** |
| 実施日 | 2026-09-14 |
| 環境 | ローカル Docker（`docker compose up`）：Next.js 16.3.5、FastAPI 0.141.1、MySQL 8.0.46。`APP_ENV=development`、`TEST_FIXED_NOW=2026-09-05T12:00:00` |
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
