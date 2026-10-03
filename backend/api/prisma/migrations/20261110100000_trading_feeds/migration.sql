-- CreateTable
CREATE TABLE `trade_feed_files` (
    `id` CHAR(36) NOT NULL,
    `broker_id` CHAR(36) NOT NULL,
    `adapter` VARCHAR(24) NOT NULL,
    `filename` VARCHAR(200) NOT NULL,
    `format` VARCHAR(8) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `status` VARCHAR(12) NOT NULL,
    `lines_total` INTEGER NOT NULL DEFAULT 0,
    `lines_matched` INTEGER NOT NULL DEFAULT 0,
    `lines_break` INTEGER NOT NULL DEFAULT 0,
    `lines_duplicate` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(500) NULL,
    `uploaded_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `trade_feed_files_created_at_idx`(`created_at`),
    UNIQUE INDEX `trade_feed_files_broker_id_sha256_key`(`broker_id`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trade_feed_lines` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `file_id` CHAR(36) NULL,
    `broker_id` CHAR(36) NULL,
    `dedupe_key` CHAR(64) NOT NULL,
    `external_ref` VARCHAR(120) NOT NULL,
    `order_ref` VARCHAR(32) NULL,
    `broker_order_ref` VARCHAR(64) NULL,
    `order_id` CHAR(36) NULL,
    `fill_id` CHAR(36) NULL,
    `ticker` VARCHAR(32) NOT NULL,
    `side` VARCHAR(4) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `price` DECIMAL(20, 6) NOT NULL,
    `fees` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `trade_date` DATE NOT NULL,
    `executed_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(12) NOT NULL,
    `break_reason` VARCHAR(24) NULL,
    `detail` VARCHAR(500) NULL,
    `raw` JSON NULL,
    `resolved_by` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolution` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trade_feed_lines_ref_key`(`ref`),
    UNIQUE INDEX `trade_feed_lines_dedupe_key_key`(`dedupe_key`),
    INDEX `trade_feed_lines_status_created_at_idx`(`status`, `created_at`),
    INDEX `trade_feed_lines_order_id_idx`(`order_id`),
    INDEX `trade_feed_lines_file_id_idx`(`file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settlement_instructions` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `order_ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `ticker` VARCHAR(24) NOT NULL,
    `side` VARCHAR(4) NOT NULL,
    `instruction_type` VARCHAR(3) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `avg_price` DECIMAL(20, 6) NOT NULL,
    `gross_amount` DECIMAL(20, 4) NOT NULL,
    `fees` DECIMAL(20, 4) NOT NULL,
    `net_amount` DECIMAL(20, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `trade_date` DATE NOT NULL,
    `settle_date` DATE NOT NULL,
    `broker_id` CHAR(36) NULL,
    `counterparty_id` CHAR(36) NULL,
    `account_ref` VARCHAR(64) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'GENERATED',
    `payload` JSON NOT NULL,
    `generated_by` CHAR(36) NOT NULL,
    `released_by` CHAR(36) NULL,
    `released_at` DATETIME(3) NULL,
    `confirmed_by` CHAR(36) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `fail_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `settlement_instructions_ref_key`(`ref`),
    UNIQUE INDEX `settlement_instructions_order_id_key`(`order_id`),
    INDEX `settlement_instructions_status_settle_date_idx`(`status`, `settle_date`),
    INDEX `settlement_instructions_portfolio_id_idx`(`portfolio_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ca_feed_items` (
    `id` CHAR(36) NOT NULL,
    `dedupe_key` CHAR(64) NOT NULL,
    `source` VARCHAR(24) NOT NULL,
    `source_ref` VARCHAR(120) NULL,
    `ticker` VARCHAR(24) NOT NULL,
    `ca_type` VARCHAR(20) NOT NULL,
    `ex_date` DATE NULL,
    `status` VARCHAR(12) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `event_id` CHAR(36) NULL,
    `announcement` JSON NOT NULL,
    `seen_count` INTEGER NOT NULL DEFAULT 1,
    `run_id` CHAR(36) NULL,
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ca_feed_items_dedupe_key_key`(`dedupe_key`),
    INDEX `ca_feed_items_status_first_seen_at_idx`(`status`, `first_seen_at`),
    INDEX `ca_feed_items_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ca_feed_runs` (
    `id` CHAR(36) NOT NULL,
    `trigger` VARCHAR(12) NOT NULL,
    `provider` VARCHAR(12) NOT NULL,
    `status` VARCHAR(12) NOT NULL,
    `fetched` INTEGER NOT NULL DEFAULT 0,
    `drafted` INTEGER NOT NULL DEFAULT 0,
    `duplicates` INTEGER NOT NULL DEFAULT 0,
    `rejected` INTEGER NOT NULL DEFAULT 0,
    `error` VARCHAR(500) NULL,
    `started_by` CHAR(36) NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `ca_feed_runs_started_at_idx`(`started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

