-- Package S3: import and export framework, ledger FX stamps and corrections. Additive.

-- CreateTable
CREATE TABLE `import_batches` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `filename` VARCHAR(200) NOT NULL,
    `format` VARCHAR(8) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `file_id` CHAR(36) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PREVIEWED',
    `row_count` INTEGER NOT NULL,
    `valid_count` INTEGER NOT NULL,
    `error_count` INTEGER NOT NULL,
    `control_json` JSON NULL,
    `errors_json` JSON NULL,
    `preview_json` JSON NULL,
    `result_json` JSON NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `committed_by` CHAR(36) NULL,
    `committed_at` DATETIME(3) NULL,

    UNIQUE INDEX `import_batches_ref_key`(`ref`),
    INDEX `import_batches_kind_created_at_idx`(`kind`, `created_at`),
    INDEX `import_batches_kind_sha256_idx`(`kind`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_fx_stamps` (
    `id` CHAR(36) NOT NULL,
    `entry_id` VARCHAR(80) NOT NULL,
    `entry_type` VARCHAR(32) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `txn_date` DATE NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `reporting_currency` CHAR(3) NOT NULL,
    `rate` DECIMAL(20, 10) NOT NULL,
    `rate_date` DATE NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'FX_RATES',
    `amount` DECIMAL(20, 4) NOT NULL,
    `reporting_amount` DECIMAL(20, 4) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    `correction_id` CHAR(36) NULL,
    `stamped_by` CHAR(36) NULL,
    `stamped_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ledger_fx_stamps_client_id_fund_id_idx`(`client_id`, `fund_id`),
    INDEX `ledger_fx_stamps_txn_date_idx`(`txn_date`),
    UNIQUE INDEX `ledger_fx_stamps_entry_id_reporting_currency_version_key`(`entry_id`, `reporting_currency`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_corrections` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `entry_id` VARCHAR(80) NOT NULL,
    `entry_type` VARCHAR(32) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `reporting_currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `new_rate` DECIMAL(20, 10) NULL,
    `new_rate_date` DATE NULL,
    `adjustment_amount` DECIMAL(20, 4) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL',
    `maker_id` CHAR(36) NOT NULL,
    `checker_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `ledger_corrections_ref_key`(`ref`),
    INDEX `ledger_corrections_entry_id_idx`(`entry_id`),
    INDEX `ledger_corrections_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
