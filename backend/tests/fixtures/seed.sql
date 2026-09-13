-- テストデータ（test_spec.md 3）。すべて架空のデータ
-- 何度でも再投入できるよう、先頭で全テーブルを空にする。DML のみでアプリ用ユーザーでも実行できる
-- 担当者のパスワードは test_spec.md 3.1 の平文から事前に計算した Argon2id ハッシュ（argon2-cffi 既定パラメータ）

SET NAMES utf8mb4;

-- 外部キーの参照先より先に参照元を空にする
DELETE FROM transaction_detail;
DELETE FROM `transaction`;
DELETE FROM refresh_token;
DELETE FROM discount_campaign;
DELETE FROM tax_rate;
DELETE FROM member;
DELETE FROM product;
DELETE FROM staff;

-- 3.1 担当者
INSERT INTO staff (staff_id, name, password_hash, failed_count, locked_until, is_active) VALUES
('S001', '店主',         '$argon2id$v=19$m=65536,t=3,p=4$B5sr8Obu6IXGXUu3rkzgQg$QvfztdxmGUK5hbC3yVK7pIEU2EzTi4yU/LUI/j9ST1E', 0, NULL, TRUE),
('S002', 'アルバイトA',  '$argon2id$v=19$m=65536,t=3,p=4$YOZsN8hrkZKvyelDG9BVkg$R9qdjnScH5HnKPvSgE95+d7EYS7LGmMJFzbIlsIVs+o', 0, NULL, TRUE),
('S003', '退職者',       '$argon2id$v=19$m=65536,t=3,p=4$lQWTNy1jpifZfHH+JzrK7Q$vvQRg9APzvXA2aScXosDGPsG01CKt7/dIEFpo/V50+c', 0, NULL, FALSE),
('S004', 'ロック検証用', '$argon2id$v=19$m=65536,t=3,p=4$/yrJ5uiBBEDhDaJH5ZMyQQ$PjvEKuA1g9TnqQkCt52XdjlBIX829XYcu90i1V+JpaA', 0, NULL, TRUE);

-- 3.2 会員（M999999 は未登録の異常系のため投入しない）
INSERT INTO member (member_id, name, phone, address, gender, age) VALUES
('M000001', '山田太郎', '090-0000-0001', '東京都〇〇区', '男', 35),
('M000002', '鈴木花子', NULL,            NULL,           '女', 28);

-- 3.3 商品（9999 は未登録の異常系のため投入しない）
INSERT INTO product (product_code, name, unit_price, is_discontinued) VALUES
('1001', '醤油ラーメン', 850,   FALSE),
('1002', '味噌ラーメン', 900,   FALSE),
('1003', '冷やし中華',   950,   FALSE),
('1004', '特製ラーメン', 855,   FALSE),
('2001', '味玉',         120,   FALSE),
('2002', 'のり',         100,   FALSE),
('2003', 'メンマ',       150,   FALSE),
('3001', '餃子',         400,   FALSE),
('4001', '瓶ビール',     500,   FALSE),
('5001', 'サービス品',   0,     FALSE),
('5002', '上限価格品',   99999, FALSE),
('1099', '旧メニュー',   900,   TRUE);

-- 3.4 税率
INSERT INTO tax_rate (id, tax_category, rate_bp, effective_from) VALUES
(1, 'standard', 1000, '2019-10-01'),
(2, 'standard', 1200, '2027-04-01');

-- 3.5 値引き企画
INSERT INTO discount_campaign (campaign_id, name, product_code, discount_type, discount_value, start_date, end_date) VALUES
(1, '常連感謝トッピング企画', '2001', 'amount',  20,  '2026-09-01', '2026-09-07'),
(2, '常連感謝トッピング企画', '2002', 'amount',  20,  '2026-09-01', '2026-09-07'),
(3, '常連感謝トッピング企画', '2003', 'amount',  20,  '2026-09-01', '2026-09-07'),
(4, '夏の冷やし応援',         '1003', 'percent', 10,  '2026-07-01', '2026-08-31'),
(5, '端数検証用',             '1004', 'percent', 10,  '2026-09-01', '2026-09-30'),
(6, '値引き上限検証用',       '2002', 'amount',  150, '2026-09-08', '2026-09-30');
