-- CreateTable
CREATE TABLE `md_source_status` (
    `id` CHAR(36) NOT NULL,
    `source` VARCHAR(24) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_attempt_at` DATETIME(3) NULL,
    `last_success_at` DATETIME(3) NULL,
    `last_status` VARCHAR(16) NULL,
    `last_error` VARCHAR(500) NULL,
    `last_count` INTEGER NOT NULL DEFAULT 0,
    `consecutive_failures` INTEGER NOT NULL DEFAULT 0,
    `backoff_until` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `md_source_status_source_key`(`source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `md_provenance` (
    `id` CHAR(36) NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `ref_type` VARCHAR(8) NOT NULL,
    `ref_id` CHAR(36) NULL,
    `security_id` CHAR(36) NULL,
    `ticker` VARCHAR(32) NOT NULL,
    `price_date` DATE NULL,
    `source` VARCHAR(24) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `fetched_at` DATETIME(3) NOT NULL,
    `raw_hash` CHAR(64) NOT NULL,
    `raw_value` VARCHAR(80) NULL,
    `value` DECIMAL(24, 10) NULL,
    `previous_value` DECIMAL(24, 10) NULL,
    `status` VARCHAR(12) NOT NULL,
    `reason` VARCHAR(300) NULL,
    `seen_count` INTEGER NOT NULL DEFAULT 1,
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `md_provenance_key_hash_key`(`key_hash`),
    INDEX `md_provenance_ref_type_ref_id_idx`(`ref_type`, `ref_id`),
    INDEX `md_provenance_security_id_fetched_at_idx`(`security_id`, `fetched_at`),
    INDEX `md_provenance_status_fetched_at_idx`(`status`, `fetched_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `md_refresh_runs` (
    `id` CHAR(36) NOT NULL,
    `trigger` VARCHAR(12) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `scope` VARCHAR(12) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'RUNNING',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `requested_by` CHAR(36) NULL,
    `accepted` INTEGER NOT NULL DEFAULT 0,
    `rejected` INTEGER NOT NULL DEFAULT 0,
    `errors` INTEGER NOT NULL DEFAULT 0,
    `skipped` INTEGER NOT NULL DEFAULT 0,
    `summary` JSON NULL,

    INDEX `md_refresh_runs_started_at_idx`(`started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custodian_feed_files` (
    `id` CHAR(36) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `adapter` VARCHAR(12) NOT NULL,
    `filename` VARCHAR(200) NOT NULL,
    `format` VARCHAR(8) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `account_ref` VARCHAR(64) NULL,
    `statement_date` DATE NULL,
    `currency` CHAR(3) NULL,
    `closing_cash` DECIMAL(20, 2) NULL,
    `holdings_mv` DECIMAL(20, 2) NULL,
    `status` VARCHAR(12) NOT NULL,
    `trades_imported` INTEGER NOT NULL DEFAULT 0,
    `trades_skipped` INTEGER NOT NULL DEFAULT 0,
    `holdings_count` INTEGER NOT NULL DEFAULT 0,
    `day_end_ref` VARCHAR(20) NULL,
    `warnings` JSON NULL,
    `error` VARCHAR(500) NULL,
    `uploaded_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `custodian_feed_files_counterparty_id_created_at_idx`(`counterparty_id`, `created_at`),
    UNIQUE INDEX `custodian_feed_files_counterparty_id_sha256_key`(`counterparty_id`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `custodian_feed_holdings` (
    `id` CHAR(36) NOT NULL,
    `file_id` CHAR(36) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `account_ref` VARCHAR(64) NOT NULL,
    `statement_date` DATE NOT NULL,
    `ticker` VARCHAR(32) NOT NULL,
    `isin` VARCHAR(12) NULL,
    `quantity` DECIMAL(24, 8) NOT NULL,
    `price` DECIMAL(20, 8) NULL,
    `market_value` DECIMAL(20, 2) NULL,
    `currency` CHAR(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `custodian_feed_holdings_file_id_idx`(`file_id`),
    UNIQUE INDEX `custodian_feed_holdings_counterparty_id_account_ref_statemen_key`(`counterparty_id`, `account_ref`, `statement_date`, `ticker`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

