-- CreateTable
CREATE TABLE `recon_account_map` (
    `id` CHAR(36) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `account_ref` VARCHAR(64) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recon_account_map_portfolio_id_idx`(`portfolio_id`),
    UNIQUE INDEX `recon_account_map_counterparty_id_account_ref_key`(`counterparty_id`, `account_ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recon_runs` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `scope_key` VARCHAR(190) NOT NULL,
    `family` VARCHAR(16) NOT NULL,
    `as_of_date` DATE NOT NULL,
    `counterparty_id` CHAR(36) NULL,
    `portfolio_id` CHAR(36) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'CLEAN',
    `matched_count` INTEGER NOT NULL DEFAULT 0,
    `break_count` INTEGER NOT NULL DEFAULT 0,
    `params` JSON NULL,
    `summary` JSON NULL,
    `run_count` INTEGER NOT NULL DEFAULT 1,
    `run_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recon_runs_ref_key`(`ref`),
    UNIQUE INDEX `recon_runs_scope_key_key`(`scope_key`),
    INDEX `recon_runs_family_as_of_date_idx`(`family`, `as_of_date`),
    INDEX `recon_runs_counterparty_id_idx`(`counterparty_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recon_breaks` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `family` VARCHAR(16) NOT NULL,
    `item_key` VARCHAR(190) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `internal_value` JSON NULL,
    `external_value` JSON NULL,
    `difference` DECIMAL(24, 6) NULL,
    `difference_pct` DECIMAL(14, 4) NULL,
    `currency` CHAR(3) NULL,
    `cause` VARCHAR(32) NULL,
    `severity` VARCHAR(12) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'NEW',
    `owner_user_id` CHAR(36) NULL,
    `counterparty_id` CHAR(36) NULL,
    `portfolio_id` CHAR(36) NULL,
    `resolution_note` VARCHAR(2000) NULL,
    `evidence_ref` VARCHAR(255) NULL,
    `maker_id` CHAR(36) NULL,
    `checker_id` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recon_breaks_ref_key`(`ref`),
    INDEX `recon_breaks_status_severity_idx`(`status`, `severity`),
    INDEX `recon_breaks_family_status_idx`(`family`, `status`),
    INDEX `recon_breaks_owner_user_id_idx`(`owner_user_id`),
    INDEX `recon_breaks_counterparty_id_idx`(`counterparty_id`),
    UNIQUE INDEX `recon_breaks_run_id_item_key_key`(`run_id`, `item_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recon_break_events` (
    `id` CHAR(36) NOT NULL,
    `break_id` CHAR(36) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `from_status` VARCHAR(20) NULL,
    `to_status` VARCHAR(20) NULL,
    `actor_id` CHAR(36) NULL,
    `note` VARCHAR(2000) NULL,
    `detail` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recon_break_events_break_id_created_at_idx`(`break_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recon_signoffs` (
    `id` CHAR(36) NOT NULL,
    `scope_key` VARCHAR(190) NOT NULL,
    `family` VARCHAR(16) NOT NULL,
    `as_of_date` DATE NOT NULL,
    `counterparty_id` CHAR(36) NULL,
    `signed_by` CHAR(36) NOT NULL,
    `signed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `note` VARCHAR(1000) NULL,
    `summary` JSON NULL,

    UNIQUE INDEX `recon_signoffs_scope_key_key`(`scope_key`),
    INDEX `recon_signoffs_family_as_of_date_idx`(`family`, `as_of_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recon_breaks` ADD CONSTRAINT `recon_breaks_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `recon_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recon_break_events` ADD CONSTRAINT `recon_break_events_break_id_fkey` FOREIGN KEY (`break_id`) REFERENCES `recon_breaks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

