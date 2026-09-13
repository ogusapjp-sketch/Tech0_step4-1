# 採用パッケージとバージョンの記録

design.md 7.6 に基づき、採用したパッケージのバージョン、確認日、脆弱性情報の確認結果を記録する。
バージョンは Claude Code が調査して案を出し、人間が承認してから採用する。

## 確認方法

| 項目 | 方法 |
|---|---|
| 最新安定版 | PyPI JSON API（`https://pypi.org/pypi/<package>/json`）、`npm view <package> version`、Docker Hub のタグ一覧 |
| 脆弱性 | OSV（`https://api.osv.dev/v1/querybatch`）で、採用するバージョンを指定して照会。OSV は GitHub Advisory Database と PyPA Advisory Database（NVD の CVE を含む）を集約している |

## ランタイム

| 種別 | 採用 | 確認日 | 状態 |
|---|---|---|---|
| Python | 3.11（Docker イメージ `python:3.11.16-slim`） | 2026-09-13 | 承認済み |
| MySQL | 8.0（Docker イメージ `mysql:8.0.46`） | 2026-09-13 | 承認済み |
| Node.js | 24 | — | バージョンは承認済み。Docker イメージは段階8で提案 |

ローカルの単体テストは `backend/.venv`（Anaconda の Python 3.11.7 から作成）で実行する。

## バックエンド（Python）

承認日：2026-09-13。脆弱性の確認日：2026-09-13。

### 直接依存

| パッケージ | バージョン | 用途 | 既知の脆弱性 | 導入した段階 |
|---|---|---|---|---|
| fastapi | 0.141.1 | Web フレームワーク | なし | 未導入（段階8） |
| uvicorn | 0.52.4 | ASGI サーバ | なし | 未導入（段階8） |
| SQLAlchemy | 2.0.52 | ORM | なし | 未導入（段階8） |
| pydantic | 2.13.5 | 入力検証 | なし | 段階4 |
| PyMySQL | 1.2.0 | MySQL 接続ドライバ | なし | 未導入（段階8） |
| cryptography | 50.0.1 | PyMySQL が MySQL 8 の既定認証方式（caching_sha2_password）で使う | なし | 未導入（段階8） |
| PyJWT | 2.14.0 | JWT の署名・検証 | なし | 未導入（段階5） |
| argon2-cffi | 25.1.0 | パスワードハッシュ（Argon2id） | なし | 段階1 |
| httpx | 0.28.1 | 結合テストの HTTP クライアント（開発用） | なし | 未導入（段階9） |
| pytest | 9.1.1 | テスト（開発用） | なし | 段階1 |
| pytest-cov | 7.1.0 | カバレッジ（開発用） | なし | 段階1 |
| pip-audit | 2.10.1 | 脆弱性検査（開発用・CI） | なし | 未導入（段階10） |

### 間接依存（導入済みのもの）

| パッケージ | バージョン | 依存元 | 既知の脆弱性 |
|---|---|---|---|
| argon2-cffi-bindings | 26.1.0 | argon2-cffi | なし |
| cffi | 2.1.1 | argon2-cffi-bindings | なし |
| pycparser | 3.0 | cffi | なし |
| coverage | 7.16.0 | pytest-cov | なし |
| iniconfig | 2.3.0 | pytest | なし |
| packaging | 26.3 | pytest | なし |
| pluggy | 1.6.0 | pytest | なし |
| Pygments | 2.21.0 | pytest | なし |
| pydantic_core | 2.46.5 | pydantic | なし |
| annotated-types | 0.8.0 | pydantic | なし |
| typing-inspection | 0.4.4 | pydantic | なし |
| typing_extensions | 4.16.0 | pydantic | なし |

### ファイルの分け方

- `backend/requirements.txt`：本番に必要なもの（`==` 固定）
- `backend/requirements-dev.txt`：`requirements.txt` を読み込み、テスト用ツールを加えたもの。本番イメージには入れない

各段階で使い始めたパッケージを追加し、間接依存も含めて `==` で固定する。

## フロントエンド（npm）

承認日：2026-09-13。脆弱性の確認日：2026-09-13。バージョンは `frontend/package.json` に `^` なしで記載し、`package-lock.json` で間接依存まで固定する。

| パッケージ | バージョン | 用途 | 既知の脆弱性 | 導入した段階 |
|---|---|---|---|---|
| next | 16.3.5 | フレームワーク（画面・BFF）。`next/jest` でテストの TypeScript を変換 | なし | 段階3 |
| react | 19.3.0 | UI | なし | 段階3 |
| react-dom | 19.3.0 | UI | なし | 段階3 |
| typescript | 6.0.3 | 型チェック（`npm run typecheck`） | なし | 段階3 |
| jest | 30.5.1 | テスト | なし | 段階3 |
| @types/jest | 30.0.0 | 型定義 | なし | 段階3 |
| @types/node | 24.13.4 | 型定義（Node 24 に合わせる） | なし | 段階3 |
| @types/react | 19.3.0 | 型定義 | なし | 段階3 |
| @types/react-dom | 19.3.0 | 型定義 | なし | 段階3 |
| jest-environment-jsdom | 30.5.1 | 画面コンポーネントのテスト | なし | 未導入（段階8） |
| @testing-library/react | 16.3.3 | 画面コンポーネントのテスト | なし | 未導入（段階8） |
| @testing-library/dom | 10.4.1 | @testing-library/react の peer 依存 | なし | 未導入（段階8） |
| @testing-library/jest-dom | 7.0.1 | 画面コンポーネントのテスト | なし | 未導入（段階8） |
| @zxing/browser | 0.2.1 | バーコード読取のフォールバック（Code128） | なし | 未導入（段階8） |
| @zxing/library | 0.23.0 | @zxing/browser の依存 | なし | 未導入（段階8） |

**TypeScript を 7 系にしない理由**：最新は 7.0.2 だが、7 系は Go への書き直し版で従来のコンパイラ API を公開していない。ts-jest は `typescript <7` を要求し、Next.js の型チェックも従来の API を使うため、6 系の最新（6.0.3）を採用した。

**導入時の確認（段階3）**：`npm install` 後の `npm audit` は 0 件。install 時に `glob@10.5.0` の非推奨警告が出る。これは jest → @jest/transform → babel-plugin-istanbul → test-exclude の間接依存で、開発用（テスト実行時のみ）。OSV で `glob@10.5.0` に既知の脆弱性がないことを確認した。jest 側の更新を待ち、個別には上書きしない。
