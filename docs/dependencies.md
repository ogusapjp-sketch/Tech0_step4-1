# 採用パッケージとバージョンの記録

design.md 7.6 に基づき、採用したパッケージのバージョン、確認日、脆弱性情報の確認結果を記録する。
バージョンは Claude Code が調査して案を出し、人間が承認してから採用する。

**最終版（段階10、2026-09-14）**。以後の更新は Dependabot の PR と CI の脆弱性検査で管理する（「継続的な検査」の章）。

## 確認方法

| 項目 | 方法 |
|---|---|
| 最新安定版 | PyPI JSON API（`https://pypi.org/pypi/<package>/json`）、`npm view <package> version`、Docker Hub のタグ一覧、GitHub Releases（Actions） |
| 脆弱性（採用時） | OSV（`https://api.osv.dev/v1/querybatch`）で、採用するバージョンを指定して照会。OSV は GitHub Advisory Database と PyPA Advisory Database（NVD の CVE を含む）を集約している |
| 脆弱性（継続） | CI で `pip-audit` と `npm audit` を push・pull request のたびに実行（`.github/workflows/ci.yml`） |
| 更新 | Dependabot が週次で更新 PR を作る（`.github/dependabot.yml`） |

## 最終確認（2026-09-14）

| 対象 | 方法 | 結果 |
|---|---|---|
| Python：`backend/requirements.txt`・`requirements-dev.txt` の固定パッケージ 32件 | OSV で固定バージョンを照会 | 既知の脆弱性なし |
| npm：`frontend/package-lock.json` の全パッケージ 368件（間接依存を含む） | `npm audit` | 0 件 |
| Docker イメージ | 下記「ランタイム」のとおり（段階8c・8e で確認） | `node:24.21.0-slim` の OS パッケージは Dockerfile で更新を適用 |

## ランタイム

| 種別 | 採用 | 確認日 | 状態 |
|---|---|---|---|
| Python | 3.11（Docker イメージ `python:3.11.16-slim`。CI は `actions/setup-python` の 3.11） | 2026-09-13 | 承認済み |
| MySQL | 8.4（Docker イメージ `mysql:8.4.11`、Oracle Linux 9.8 ベース） | 2026-09-22 | 承認済み。Azure の検証環境に合わせて 8.0 から変更（design.md v1.5） |
| Node.js | 24（Docker イメージ `node:24.21.0-slim`、Debian 12 bookworm。CI も 24.21.0） | 2026-09-14 | 承認済み。導入は段階8e |

**`node:24.21.0-slim` の確認（段階8e）**：Docker Scout は Docker Hub へのログインが必要なため使わず、次の2点で確認した。

- Node.js 本体：nodejs.org のリリース一覧で、24.21.0（2026-09-07）が 24 系の最新。これより後にセキュリティリリースはない（直近のセキュリティリリースは 24.18.1）
- OS パッケージ：イメージ内で `apt list --upgradable` を実行し、`libpcre2-8-0` にセキュリティ更新（10.42-1 → 10.42-1+deb12u1）があることを確認。OSV の Debian 12 の情報では、10.42-1 に PCRE2 の境界外読み書きの脆弱性（DEBIAN-CVE-2026-86145 など6件）がある。`frontend/Dockerfile` で `apt-get upgrade` を実行して更新を取り込む

**`mysql:8.4.11` の確認（2026-09-22、8.0 からの変更時）**

- 最新版：Docker Hub の 8.4 系タグで 8.4.11 が最新
- OSV：エコシステムを指定しない照会で ALSA-2026:56936・RHSA-2026:56936／56973 が該当したが、いずれも AlmaLinux 8／RHEL 9 の**ディストリビューション版 mysql パッケージ**向けの勧告で、修正版が `8.4.11-1.module…`。対象 CVE（CVE-2026-46936 など8件）は上流 8.4.11 で修正済みであり、公式イメージ（Oracle 製ビルドの 8.4.11）には該当しない。RPM のリリース番号との比較による誤検知と判断した。OSV に MySQL 製品そのもののエコシステムはない
- OS パッケージ：イメージ内で `microdnf upgrade --assumeno` を実行し、更新可能な6件（openssl 3.5.5→3.5.8、libcurl、libevent など）を確認。参考までに 8.0.46 では55件だった。MySQL は公式イメージをそのまま使い（自前でビルドしない）、更新は公式イメージの更新で取り込む
- 動作確認：schema.sql・seed.sql の投入、単体テスト（pytest 247件・jest 191件）、結合テスト（`run_all.sh` の全4回）が 8.0 と同じ結果。認証方式は `root`・`pos_app` とも caching_sha2_password のままで、PyMySQL（cryptography 同梱）での接続に変更は不要だった

ローカルの単体テストは `backend/.venv`（Anaconda の Python 3.11.7 から作成）で実行する。

## バックエンド（Python）

承認日：2026-09-13。脆弱性の最終確認日：2026-09-14。

### 直接依存

| パッケージ | バージョン | 用途 | 既知の脆弱性 | 導入した段階 |
|---|---|---|---|---|
| fastapi | 0.141.1 | Web フレームワーク | なし | 段階8a |
| uvicorn | 0.52.4 | ASGI サーバ（Docker イメージの起動コマンド） | なし | 段階8c |
| SQLAlchemy | 2.0.52 | ORM | なし | 段階8a |
| pydantic | 2.13.5 | 入力検証 | なし | 段階4 |
| PyMySQL | 1.2.0 | MySQL 接続ドライバ | なし | 段階8a |
| cryptography | 50.0.1 | PyMySQL が MySQL 8 の既定認証方式（caching_sha2_password）で使う | なし | 段階8a |
| PyJWT | 2.14.0 | JWT の署名・検証 | なし | 段階5 |
| argon2-cffi | 25.1.0 | パスワードハッシュ（Argon2id） | なし | 段階1 |
| httpx | 0.28.1 | FastAPI の TestClient（段階8a）、結合テストの HTTP クライアント（段階9）。開発用 | なし | 段階8a |
| pytest | 9.1.1 | テスト（開発用） | なし | 段階1 |
| pytest-cov | 7.1.0 | カバレッジ（開発用） | なし | 段階1 |
| pip-audit | 2.10.1 | 脆弱性検査（CI 専用。requirements には含めず、CI の一時的な仮想環境に入れる） | なし | 段階10 |

### 間接依存（導入済みのもの）

脆弱性の最終確認日：2026-09-14。

| パッケージ | バージョン | 依存元 | 既知の脆弱性 |
|---|---|---|---|
| argon2-cffi-bindings | 26.1.0 | argon2-cffi | なし |
| cffi | 2.1.1 | argon2-cffi-bindings、cryptography | なし |
| pycparser | 3.0 | cffi | なし |
| coverage | 7.16.0 | pytest-cov | なし |
| iniconfig | 2.3.0 | pytest | なし |
| packaging | 26.3 | pytest | なし |
| pluggy | 1.6.0 | pytest | なし |
| Pygments | 2.21.0 | pytest | なし |
| pydantic_core | 2.46.5 | pydantic | なし |
| annotated-types | 0.8.0 | pydantic | なし |
| typing-inspection | 0.4.4 | pydantic、fastapi | なし |
| typing_extensions | 4.16.0 | pydantic、fastapi | なし |
| starlette | 1.6.0 | fastapi | なし |
| annotated-doc | 0.0.5 | fastapi | なし |
| anyio | 4.15.1 | starlette | なし |
| idna | 3.19 | anyio | なし |
| greenlet | 3.5.5 | SQLAlchemy（Linux の aarch64／x86_64 などでのみ。Mac の arm64 には入らないため、requirements.txt で環境マーカー付きで固定） | なし |
| httpcore | 1.0.9 | httpx（開発用） | なし |
| h11 | 0.16.0 | uvicorn（段階8c から本番用）、httpcore | なし |
| click | 8.5.0 | uvicorn | なし |
| certifi | 2026.7.22 | httpx（開発用） | なし |

**段階8a の注意**：FastAPI の TestClient を使うと、Starlette 1.6 から「`httpx` ではなく `httpx2` を使う」旨の非推奨警告が出る。テストの動作には影響しない。`httpx2` は未承認のため、現時点では承認済みの `httpx` を使い続ける。

### ファイルの分け方

- `backend/requirements.txt`：本番に必要なもの（`==` 固定）
- `backend/requirements-dev.txt`：`requirements.txt` を読み込み、テスト用ツールを加えたもの。本番イメージには入れない

各段階で使い始めたパッケージを追加し、間接依存も含めて `==` で固定する。

## フロントエンド（npm）

承認日：2026-09-13。脆弱性の最終確認日：2026-09-14。バージョンは `frontend/package.json` に `^` なしで記載し、`package-lock.json` で間接依存まで固定する。

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
| jest-environment-jsdom | 30.5.1 | 画面コンポーネントのテスト | なし | 段階8e |
| @testing-library/react | 16.3.3 | 画面コンポーネントのテスト | なし | 段階8e |
| @testing-library/dom | 10.4.1 | @testing-library/react の peer 依存 | なし | 段階8e |
| @testing-library/jest-dom | 7.0.1 | 画面コンポーネントのテスト | なし | 段階8e |
| @zxing/browser | 0.2.1 | バーコード読取のフォールバック（Code128） | なし | 段階8e |
| @zxing/library | 0.23.0 | @zxing/browser の依存 | なし | 段階8e |

**TypeScript を 7 系にしない理由**：最新は 7.0.2 だが、7 系は Go への書き直し版で従来のコンパイラ API を公開していない。ts-jest は `typescript <7` を要求し、Next.js の型チェックも従来の API を使うため、6 系の最新（6.0.3）を採用した。

**導入時の確認（段階3）**：`npm install` 後の `npm audit` は 0 件。install 時に `glob@10.5.0` の非推奨警告が出る。これは jest → @jest/transform → babel-plugin-istanbul → test-exclude の間接依存で、開発用（テスト実行時のみ）。OSV で `glob@10.5.0` に既知の脆弱性がないことを確認した。jest 側の更新を待ち、個別には上書きしない。

## 継続的な検査（段階10）

### CI（`.github/workflows/ci.yml`）

push と pull request のたびに実行する。どれか1つでも失敗したらビルドは失敗する。

| ジョブ | 検査 | 失敗の条件 |
|---|---|---|
| backend | `pytest --cov=app --cov-branch`（単体テスト） | テストが1件でも失敗 |
| backend | カバレッジ（`.github/scripts/check_python_coverage.py`） | Statements・Branch のどちらかが 80% 未満（test_spec.md 2.5） |
| backend | `pip-audit --strict -r requirements-dev.txt`（requirements.txt も読み込まれる） | **既知の脆弱性が1件でもある**（下記） |
| frontend | `jest --coverage`（単体テスト。Statements・Branch のしきい値 80%） | テストが1件でも失敗、またはカバレッジが 80% 未満 |
| frontend | `npm run typecheck`（`tsc --noEmit`） | 型エラーがある |
| frontend | `npm run build`（`next build`） | 本番ビルドが失敗する。TypeScript のコンパイラ API を使うため、型チェックでは見つからない互換性の問題を検知する |
| frontend | `npm audit --audit-level=high` | High 以上の脆弱性がある（design.md 7.6） |

**pip-audit の失敗条件（人間が決定）**：pip-audit 2.10.1 には深刻度で絞り込む機能がない（除外は `--ignore-vuln <ID>` のみ）。そのため design.md 7.6 の「High 以上で失敗」より厳しく、深刻度に関係なく既知の脆弱性があれば失敗させる。修正版がなく許容する場合は、ワークフローに `--ignore-vuln <ID>` を追加し、次の表に理由を記録する。

| 許容した脆弱性の ID | パッケージ | 理由 | 記録日 |
|---|---|---|---|
| （なし） | | | |

**Actions のバージョン**（2026-09-14 確認。いずれも最新）：`actions/checkout@v7`（v7.0.1）、`actions/setup-python@v7`（v7.0.0）、`actions/setup-node@v7`（v7.0.0）。

### Dependabot（`.github/dependabot.yml`）

| 対象 | ディレクトリ | 間隔 | 追加の設定 |
|---|---|---|---|
| pip | `/backend` | 週次（Asia/Tokyo） | `pydantic-core` の更新を無視する（下記「pydantic を更新するときの運用」）。`pydantic` と `pydantic-core` のグループ設定も残す |
| npm | `/frontend` | 週次（Asia/Tokyo） | `typescript` の 7 系を無視する（上記「TypeScript を 7 系にしない理由」）。`@types/node` のメジャー更新を無視する（実行環境の Node 24 に合わせる） |

**pydantic を更新するときの運用（2026-09-14、人間が決定）**

pydantic は pydantic-core の版を `==` で固定して要求する（例：pydantic 2.13.5 は `pydantic-core==2.46.5`）。pydantic-core は pydantic より先に新しい版が出ることがあり、単体で上げると依存を満たせない。そのため Dependabot では pydantic-core の更新を無視し、pydantic の更新 PR だけを受け取る。

1. Dependabot が pydantic の更新 PR を作る（`backend/requirements.txt` の `pydantic` だけが変わる）
2. CI の backend ジョブ「依存パッケージを入れる」（`pip check`）が失敗したら、新しい pydantic が要求する pydantic-core の版を確認する（PyPI の `https://pypi.org/pypi/pydantic/<版>/json` の `requires_dist`、または `pip check` の出力）
3. その PR のブランチで `backend/requirements.txt` の `pydantic_core==` を要求された版に書き換えてコミットする。あわせて OSV で脆弱性を確認し、本書の表を更新する
4. CI がすべて成功したことを確認してからマージする

**閉じた更新 PR（2026-09-14、人間が判断）**：次の4件は、マージせずに理由をコメントして閉じ、上表の設定を追加した。

| PR | 内容 | CI | 閉じた理由 |
|---|---|---|---|
| #1 | pydantic-core 2.46.5 → 2.49.0 | 失敗（`pip check`） | pydantic 2.13.5 が pydantic-core 2.46.5 を必須にしており、単独では更新できない |
| #2 | @types/node 24.13.4 → 26.5.1 | 成功 | 実行環境が Node 24 のため、型定義も 24 系に合わせる |
| #3 | typescript 6.0.3 → 7.0.2 | 成功 | 7 系は Next.js のビルドが使うコンパイラ API がない。CI が成功したのは `next build` を実行していなかったためで、CI に `next build` を追加した |
| #4 | pydantic-core 2.46.5 → 2.49.0（pydantic グループ） | 失敗（`pip check`） | pydantic の最新版が 2.13.5 のままで、グループにしても pydantic-core だけが上がった。pydantic-core の更新を無視する設定に変更した |

Dependabot の PR でも CI が実行されるため、テスト・型チェック・脆弱性検査に合格した更新だけを取り込む。メジャー更新は design.md 7.6 の方針（セキュリティ修正を除き、実装期間中は行わない）に従って判断する。

**リポジトリの設定**：脆弱性のあるバージョンが検出されたときに更新 PR を自動生成する（design.md 7.6）には、GitHub の Settings → Code security で「Dependabot alerts」と「Dependabot security updates」を有効にする。設定ファイルでは有効にできない。
