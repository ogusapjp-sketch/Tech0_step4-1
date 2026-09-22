# Tech0_step4-1

ラーメン店「唯我独尊」のレジアプリ（簡易POSアプリ改 Lv2）の要件定義書・設計仕様書・テスト仕様書です。
Tech0プログラム Step4 の課題成果物として作成しました。

対象業態は店内飲食のみ・後払い会計のラーメン店。レジ担当者が伝票を見ながらメニュー早見表のバーコードをスキャンして会計する運用を前提としています。

## ドキュメント

| 文書 | 内容 | V字モデル上の工程 | PDF |
|---|---|---|---|
| [要件定義書（Lv2）](./requirements.md) | 要求 REQ-01〜11 から機能要件・非機能要件を導出。業務要件、Lv1→Lv2 の変更点、検証計画を含む | 要件定義 | [v1.0](./requirements_v1.0.pdf) |
| [設計仕様書（Lv2）](./design.md) | BFF 方式のシステム構成、UML（アクティビティ図・シーケンス図・クラス図）、ER図、API設計、セキュリティ設計 | 基本設計・詳細設計 | [v1.4](./design_v1.4.pdf) |
| [テスト仕様書（Lv2）](./test_spec.md) | 単体（pytest／jest）・結合・機能・ユーザーテストのケース223件。観点×技法で設計し、期待値は人間が決定 | 単体・結合・システム・受入テスト | [v1.3](./test_spec_v1.3.pdf) |

図はすべて Mermaid で記述しており、GitHub 上でそのまま描画されます。PDF 版では図を画像として埋め込んでいます。

## 実装状況

要件定義書の要求 REQ-01〜11 をすべて実装し、単体テストと結合テストで検証しました（2026-09-22 時点）。
要求とテストケースの対応は `test_spec.md` 7.1 のトレーサビリティマトリクスに従っています。

| 要求 | 実装 | 主な実装内容 | 検証したテストレベル |
|---|---|---|---|
| REQ-01 ログイン | 済 | `services/auth.py`（Argon2id、10回失敗で30分ロック、JWT とリフレッシュトークンのローテーション）、`routers/auth.py`、BFF の Cookie ↔ Authorization ヘッダの詰め替えと自動更新、`LoginForm`、`proxy.ts` の認証ガード | 単体 UT-B-65〜79／結合 IT-01〜06、28 |
| REQ-02 会員カードの読み込み | 済 | `routers/members.py`、`SqlMemberRepository`、`validate_member_id`、`classifyCode`（先頭 M で会員ID）、`MemberPanel`、`BarcodeScanner` | 単体 UT-B-46〜52、UT-F-10〜18／結合 IT-08〜10 |
| REQ-03 商品コードの手入力 | 済 | `routers/products.py`、`validate_product_code`、`ProductEntry`（照会 → 名称・単価表示 → 追加の2段階）、`cartReducer` の ADD_PRODUCT | 単体 UT-B-40〜45／結合 IT-11〜13 |
| REQ-04 税抜・税込の合計表示 | 済 | `PricingService.calculate`（整数演算のみ、税は取引ごとに1回切り捨て）、フロントの `calcTotals`（同じ期待値で一致を確認）、`TotalsPanel` | 単体 UT-B-18〜28、UT-F-01〜07／結合 IT-14 |
| REQ-05 購入確定 | 済 | `TransactionService.verify_client_totals`（フロントの金額と再計算値の照合）と `confirm`、`routers/transactions.py`、冪等キー（`idempotencyKey.ts`）、`CompletionDialog` | 単体 UT-B-80〜85／結合 IT-14〜19、36、37 |
| REQ-06 購入後のリセットと再開 | 済 | `cartReducer` の RESET、完了ポップアップを閉じたときの購入リスト・会員情報のクリア | 単体 UT-F-34／結合 IT-21、26 |
| REQ-07 購入履歴の保存 | 済 | `SqlTransactionRepository`、`models/tables.py`、`schema.sql` の `transaction`／`transaction_detail`。明細に購入時点の単価・値引き額・税率を転記 | 単体の対象関数なし（test_spec.md 7.1）／結合 IT-29〜35 |
| REQ-08 税率の可変 | 済 | `SqlTaxRateRepository`（適用開始日で選択）、`routers/settings.py`、税率は万分率の整数（`tax_rate_bp`） | 単体 UT-B-24〜26、UT-F-05／結合 IT-31 |
| REQ-09 バーコードによる商品登録 | 済 | `BarcodeScanner`（Barcode Detection API を第一候補、非対応時は ZXing にフォールバック。Code128）、連続スキャンの間隔制御（`scanCooldown.ts`） | 単体 UT-F-19〜22／結合 IT-11〜13、27 |
| REQ-10 購入リストの選択・削除・数量変更 | 済 | `cartReducer`（排他選択、削除、数量1〜99、1行あたり99個・50行の上限）、`CartList`、`SelectedLinePanel` | 単体 UT-F-23〜33／結合 IT-24 |
| REQ-11 会員特典の値引き | 済 | `PricingService.apply_discount`（割合は1個ごとに切り捨ててから数量倍、金額は単価が上限、値引きは税の前、重複時は大きい方）、`SqlCampaignRepository`、購入リストへの値引き額表示 | 単体 UT-B-01〜17、UT-B-87、UT-F-08〜09／結合 IT-07、14、22 |

機能テスト（ST-01〜41）とユーザーテスト（UAT-01〜18）は**未実施**です。Azure 検証環境（Container Apps・内部 Ingress）の構築が前提のため、本リポジトリの範囲外としています。

### テスト結果

| テストレベル | 件数 | カバレッジ | 結果 |
|---|---|---|---|
| 単体（バックエンド pytest） | 261件（UT-B-01〜87 とケース ID のない補助テスト） | Statements 100%・Branch 100%（DB 接続とリポジトリは対象外。test_spec.md 2.5） | 合格 |
| 単体（フロントエンド jest） | 191件（UT-F-01〜41 と補助テスト） | Statements 99.52%・Branch 97.30% | 合格 |
| 結合（IT） | IT-01〜37（自動28、手動9） | — | 合格 |
| 機能（ST）・ユーザー（UAT） | ST-01〜41、UAT-01〜18 | — | 未実施 |

push と pull request のたびに GitHub Actions で単体テスト・カバレッジ・型チェック・本番ビルド・脆弱性検査（pip-audit、npm audit）を実行しています。
詳細は [`docs/test_results.md`](./docs/test_results.md)。

### 動作を確認した環境

| 環境 | 内容 |
|---|---|
| ローカル（Docker Compose） | Next.js 16.3.5／FastAPI 0.141.1／MySQL 8.4.11。結合テスト IT-01〜37 に合格 |
| Azure Database for MySQL Flexible Server | **接続確認済み**（2026-09-22）。共有サーバ `gen12-mysql-pos`（MySQL 8.4）に自分専用のデータベースを作り、SSL 必須（TLSv1.3、証明書とホスト名を検証）・DML 権限のみのアプリ用ユーザーで接続。ローカルの FastAPI から結合テスト26件に合格。手順は [`docs/azure_notes.md`](./docs/azure_notes.md) |

## 前提（変更不可）

- フロントエンド：Next.js
- バックエンド：FastAPI
- インフラ：Microsoft Azure（Azure Database for MySQL Flexible Server）
- カメラ付きデバイスでバーコードを読み取る

## 作成方法

Claude（doc-coauthoring スキル）との対話で作成しました。人間が意思決定し、AI を構造化・検証に用いています。詳細は各文書の付録「生成AI活用の記録」を参照してください。
