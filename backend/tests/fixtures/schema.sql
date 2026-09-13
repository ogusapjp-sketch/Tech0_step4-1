-- テーブル定義（design.md 4.2）
-- 管理者権限で実行する。アプリ用 DB ユーザーは DML 権限のみ（design.md 7.5）
-- 日時はすべて日本時間・タイムゾーン情報なし（design.md 2.3）

SET NAMES utf8mb4;

CREATE TABLE staff (
    staff_id      VARCHAR(20)  NOT NULL,
    name          VARCHAR(50)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    failed_count  INT          NOT NULL DEFAULT 0,
    locked_until  DATETIME     NULL     DEFAULT NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    PRIMARY KEY (staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE member (
    member_id VARCHAR(20)  NOT NULL,
    name      VARCHAR(50)  NOT NULL,
    phone     VARCHAR(20)  NULL DEFAULT NULL,
    address   VARCHAR(200) NULL DEFAULT NULL,
    gender    VARCHAR(10)  NULL DEFAULT NULL,
    age       INT          NULL DEFAULT NULL,
    PRIMARY KEY (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE product (
    product_code    VARCHAR(20)  NOT NULL,
    name            VARCHAR(100) NOT NULL,
    unit_price      INT          NOT NULL,
    is_discontinued BOOLEAN      NOT NULL DEFAULT FALSE,
    PRIMARY KEY (product_code),
    CONSTRAINT chk_product_unit_price CHECK (unit_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tax_rate (
    id             INT         NOT NULL AUTO_INCREMENT,
    tax_category   VARCHAR(20) NOT NULL DEFAULT 'standard',
    rate_bp        INT         NOT NULL,
    effective_from DATE        NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_tax_rate_category_from UNIQUE (tax_category, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE discount_campaign (
    campaign_id    INT          NOT NULL AUTO_INCREMENT,
    name           VARCHAR(100) NOT NULL,
    product_code   VARCHAR(20)  NOT NULL,
    discount_type  VARCHAR(10)  NOT NULL,
    discount_value INT          NOT NULL,
    start_date     DATE         NOT NULL,
    end_date       DATE         NOT NULL,
    PRIMARY KEY (campaign_id),
    CONSTRAINT fk_discount_campaign_product
        FOREIGN KEY (product_code) REFERENCES product (product_code),
    CONSTRAINT chk_discount_campaign_value CHECK (discount_value > 0),
    CONSTRAINT chk_discount_campaign_period CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `transaction` (
    transaction_id  BIGINT      NOT NULL AUTO_INCREMENT,
    transacted_at   DATETIME    NOT NULL,
    staff_id        VARCHAR(20) NOT NULL,
    member_id       VARCHAR(20) NULL DEFAULT NULL,
    subtotal        INT         NOT NULL,
    discount_total  INT         NOT NULL DEFAULT 0,
    tax_amount      INT         NOT NULL,
    total           INT         NOT NULL,
    tax_rate_bp     INT         NOT NULL,
    idempotency_key CHAR(36)    NOT NULL,
    PRIMARY KEY (transaction_id),
    CONSTRAINT uq_transaction_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT fk_transaction_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id),
    CONSTRAINT fk_transaction_member
        FOREIGN KEY (member_id) REFERENCES member (member_id),
    INDEX idx_transaction_transacted_at (transacted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- product_code は商品マスタへの外部キーを張らない（スナップショット、design.md 4.1）
CREATE TABLE transaction_detail (
    transaction_id  BIGINT       NOT NULL,
    line_no         INT          NOT NULL,
    product_code    VARCHAR(20)  NOT NULL,
    product_name    VARCHAR(100) NOT NULL,
    unit_price      INT          NOT NULL,
    quantity        INT          NOT NULL,
    discount_amount INT          NOT NULL DEFAULT 0,
    tax_rate_bp     INT          NOT NULL,
    PRIMARY KEY (transaction_id, line_no),
    CONSTRAINT fk_transaction_detail_transaction
        FOREIGN KEY (transaction_id) REFERENCES `transaction` (transaction_id),
    CONSTRAINT chk_transaction_detail_quantity CHECK (quantity BETWEEN 1 AND 99)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE refresh_token (
    token_hash VARCHAR(64) NOT NULL,
    staff_id   VARCHAR(20) NOT NULL,
    expires_at DATETIME    NOT NULL,
    revoked    BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (token_hash),
    CONSTRAINT fk_refresh_token_staff
        FOREIGN KEY (staff_id) REFERENCES staff (staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
