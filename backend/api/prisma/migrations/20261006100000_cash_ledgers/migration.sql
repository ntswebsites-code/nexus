-- Cash & Ledgers. Additive: cash ledgers, journals, reservations, expectations, statement imports and period closes.
-- CreateTable
CREATE TABLE `cash_ledgers` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `kind` VARCHAR(12) NOT NULL DEFAULT 'BANK',
    `cash_account_id` CHAR(36) NULL,
    `min_buffer` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `tolerance` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_ledgers_ref_key`(`ref`),
    INDEX `cash_ledgers_portfolio_id_kind_idx`(`portfolio_id`, `kind`),
    INDEX `cash_ledgers_cash_account_id_idx`(`cash_account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_journals` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `entry_date` DATE NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `purpose` VARCHAR(24) NOT NULL DEFAULT 'MANUAL_CORRECTION',
    `source_ref` VARCHAR(80) NULL,
    `evidence_ref` VARCHAR(120) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `total_debit` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `total_credit` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `maker_id` CHAR(36) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `posted_by` CHAR(36) NULL,
    `posted_at` DATETIME(3) NULL,
    `reject_reason` VARCHAR(500) NULL,
    `expectation_id` CHAR(36) NULL,
    `reservation_id` CHAR(36) NULL,
    `reversal_of_id` CHAR(36) NULL,
    `reversed_by_id` CHAR(36) NULL,
    `reversed_at` DATETIME(3) NULL,
    `reverse_reason` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_journals_ref_key`(`ref`),
    INDEX `cash_journals_portfolio_id_entry_date_idx`(`portfolio_id`, `entry_date`),
    INDEX `cash_journals_portfolio_id_status_idx`(`portfolio_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_journal_lines` (
    `id` CHAR(36) NOT NULL,
    `journal_id` CHAR(36) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `ledger_id` CHAR(36) NOT NULL,
    `debit` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `credit` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `memo` VARCHAR(255) NULL,

    INDEX `cash_journal_lines_journal_id_idx`(`journal_id`),
    INDEX `cash_journal_lines_ledger_id_idx`(`ledger_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_reservations` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `ledger_id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NULL,
    `source` VARCHAR(80) NOT NULL,
    `purpose` VARCHAR(20) NOT NULL DEFAULT 'BUY_SETTLEMENT',
    `currency` CHAR(3) NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `consumed` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `required_date` DATE NOT NULL,
    `expires_on` DATE NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `created_by` CHAR(36) NOT NULL,
    `released_by` CHAR(36) NULL,
    `released_at` DATETIME(3) NULL,
    `release_reason` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_reservations_ref_key`(`ref`),
    INDEX `cash_reservations_portfolio_id_status_idx`(`portfolio_id`, `status`),
    INDEX `cash_reservations_ledger_id_status_idx`(`ledger_id`, `status`),
    INDEX `cash_reservations_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_expectations` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `ledger_id` CHAR(36) NOT NULL,
    `direction` VARCHAR(3) NOT NULL,
    `kind` VARCHAR(16) NOT NULL DEFAULT 'OTHER',
    `source` VARCHAR(80) NULL,
    `currency` CHAR(3) NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `expected_date` DATE NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'EXPECTED',
    `journal_id` CHAR(36) NULL,
    `note` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_expectations_ref_key`(`ref`),
    INDEX `cash_expectations_portfolio_id_status_idx`(`portfolio_id`, `status`),
    INDEX `cash_expectations_ledger_id_expected_date_idx`(`ledger_id`, `expected_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_statement_imports` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `ledger_id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `filename` VARCHAR(200) NOT NULL,
    `file_hash` CHAR(64) NOT NULL,
    `format` VARCHAR(8) NOT NULL,
    `statement_from` DATE NOT NULL,
    `statement_to` DATE NOT NULL,
    `opening_balance` DECIMAL(20, 4) NOT NULL,
    `closing_balance` DECIMAL(20, 4) NOT NULL,
    `line_count` INTEGER NOT NULL,
    `variance` DECIMAL(20, 4) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'STAGED',
    `maker_id` CHAR(36) NOT NULL,
    `checker_id` CHAR(36) NULL,
    `committed_at` DATETIME(3) NULL,
    `reject_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_statement_imports_ref_key`(`ref`),
    INDEX `cash_statement_imports_portfolio_id_status_idx`(`portfolio_id`, `status`),
    INDEX `cash_statement_imports_ledger_id_statement_to_idx`(`ledger_id`, `statement_to`),
    UNIQUE INDEX `cash_statement_imports_ledger_id_file_hash_key`(`ledger_id`, `file_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_statement_lines` (
    `id` CHAR(36) NOT NULL,
    `import_id` CHAR(36) NOT NULL,
    `ledger_id` CHAR(36) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `value_date` DATE NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `reference` VARCHAR(120) NULL,
    `description` VARCHAR(255) NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'UNMATCHED',
    `matched_journal_id` CHAR(36) NULL,
    `matched_at` DATETIME(3) NULL,
    `note` VARCHAR(255) NULL,

    INDEX `cash_statement_lines_import_id_idx`(`import_id`),
    INDEX `cash_statement_lines_ledger_id_fingerprint_idx`(`ledger_id`, `fingerprint`),
    INDEX `cash_statement_lines_ledger_id_status_value_date_idx`(`ledger_id`, `status`, `value_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_period_closes` (
    `id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `period_end` DATE NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PREPARED',
    `prepared_by` CHAR(36) NOT NULL,
    `prepared_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `closed_by` CHAR(36) NULL,
    `closed_at` DATETIME(3) NULL,
    `reopened_by` CHAR(36) NULL,
    `reopened_at` DATETIME(3) NULL,
    `reopen_reason` VARCHAR(500) NULL,
    `close_snapshot` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `cash_period_closes_portfolio_id_status_idx`(`portfolio_id`, `status`),
    UNIQUE INDEX `cash_period_closes_portfolio_id_period_end_key`(`portfolio_id`, `period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cash_journal_lines` ADD CONSTRAINT `cash_journal_lines_journal_id_fkey` FOREIGN KEY (`journal_id`) REFERENCES `cash_journals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_journal_lines` ADD CONSTRAINT `cash_journal_lines_ledger_id_fkey` FOREIGN KEY (`ledger_id`) REFERENCES `cash_ledgers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_statement_lines` ADD CONSTRAINT `cash_statement_lines_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `cash_statement_imports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

