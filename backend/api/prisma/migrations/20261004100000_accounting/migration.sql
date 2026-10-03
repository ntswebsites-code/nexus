-- Accounting & Close. Additive: chart of accounts, journals, journal lines and accounting periods.
-- CreateTable
CREATE TABLE `acc_accounts` (
    `id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `type` VARCHAR(12) NOT NULL,
    `description` VARCHAR(500) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `acc_accounts_portfolio_id_type_idx`(`portfolio_id`, `type`),
    UNIQUE INDEX `acc_accounts_portfolio_id_code_key`(`portfolio_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acc_journals` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `entry_date` DATE NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `total_debit` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `total_credit` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `maker_id` CHAR(36) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `posted_by` CHAR(36) NULL,
    `posted_at` DATETIME(3) NULL,
    `reversal_of_id` CHAR(36) NULL,
    `reversed_by_id` CHAR(36) NULL,
    `reversed_at` DATETIME(3) NULL,
    `reverse_reason` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `acc_journals_ref_key`(`ref`),
    INDEX `acc_journals_portfolio_id_entry_date_idx`(`portfolio_id`, `entry_date`),
    INDEX `acc_journals_portfolio_id_status_idx`(`portfolio_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acc_journal_lines` (
    `id` CHAR(36) NOT NULL,
    `journal_id` CHAR(36) NOT NULL,
    `line_no` INTEGER NOT NULL,
    `account_id` CHAR(36) NOT NULL,
    `debit` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `credit` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `memo` VARCHAR(255) NULL,

    INDEX `acc_journal_lines_journal_id_idx`(`journal_id`),
    INDEX `acc_journal_lines_account_id_idx`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acc_periods` (
    `id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `closing_by` CHAR(36) NULL,
    `closing_at` DATETIME(3) NULL,
    `closed_by` CHAR(36) NULL,
    `closed_at` DATETIME(3) NULL,
    `reopened_by` CHAR(36) NULL,
    `reopened_at` DATETIME(3) NULL,
    `reopen_reason` VARCHAR(500) NULL,
    `close_snapshot` JSON NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `acc_periods_portfolio_id_status_idx`(`portfolio_id`, `status`),
    UNIQUE INDEX `acc_periods_portfolio_id_period_end_key`(`portfolio_id`, `period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `acc_journal_lines` ADD CONSTRAINT `acc_journal_lines_journal_id_fkey` FOREIGN KEY (`journal_id`) REFERENCES `acc_journals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `acc_journal_lines` ADD CONSTRAINT `acc_journal_lines_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `acc_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

