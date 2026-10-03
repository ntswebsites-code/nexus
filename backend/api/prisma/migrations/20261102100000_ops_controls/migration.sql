-- CreateTable
CREATE TABLE `pay_recon_runs` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `scope_key` VARCHAR(120) NOT NULL,
    `fund_id` CHAR(36) NULL,
    `date_from` DATE NOT NULL,
    `date_to` DATE NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `item_count` INTEGER NOT NULL DEFAULT 0,
    `matched_count` INTEGER NOT NULL DEFAULT 0,
    `break_count` INTEGER NOT NULL DEFAULT 0,
    `not_due_count` INTEGER NOT NULL DEFAULT 0,
    `line_count` INTEGER NOT NULL DEFAULT 0,
    `params` JSON NULL,
    `summary` JSON NULL,
    `run_count` INTEGER NOT NULL DEFAULT 1,
    `run_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pay_recon_runs_ref_key`(`ref`),
    UNIQUE INDEX `pay_recon_runs_scope_key_key`(`scope_key`),
    INDEX `pay_recon_runs_date_to_idx`(`date_to`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pay_recon_items` (
    `id` CHAR(36) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `document_ref` VARCHAR(16) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `payee_name` VARCHAR(255) NOT NULL,
    `direction` VARCHAR(3) NOT NULL,
    `expected_amount` DECIMAL(20, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `due_date` DATE NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'NOT_DUE',
    `matched_line_id` CHAR(36) NULL,
    `matched_amount` DECIMAL(20, 4) NULL,
    `match_method` VARCHAR(12) NULL,
    `matched_at` DATETIME(3) NULL,
    `deferred_until` DATE NULL,
    `last_run_id` CHAR(36) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pay_recon_items_matched_line_id_key`(`matched_line_id`),
    INDEX `pay_recon_items_status_idx`(`status`),
    INDEX `pay_recon_items_fund_id_due_date_idx`(`fund_id`, `due_date`),
    UNIQUE INDEX `pay_recon_item_src`(`kind`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pay_recon_breaks` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `item_key` VARCHAR(80) NOT NULL,
    `item_id` CHAR(36) NULL,
    `line_id` CHAR(36) NULL,
    `fund_id` CHAR(36) NULL,
    `kind` VARCHAR(20) NOT NULL,
    `label` VARCHAR(400) NOT NULL,
    `expected` JSON NULL,
    `actual` JSON NULL,
    `difference` DECIMAL(20, 4) NULL,
    `currency` CHAR(3) NULL,
    `severity` VARCHAR(10) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `owner_user_id` CHAR(36) NULL,
    `resolution` VARCHAR(24) NULL,
    `rationale` VARCHAR(1000) NULL,
    `evidence_ref` VARCHAR(200) NULL,
    `resolution_data` JSON NULL,
    `maker_id` CHAR(36) NULL,
    `checker_id` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `last_run_id` CHAR(36) NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pay_recon_breaks_ref_key`(`ref`),
    UNIQUE INDEX `pay_recon_breaks_item_key_key`(`item_key`),
    INDEX `pay_recon_breaks_status_severity_idx`(`status`, `severity`),
    INDEX `pay_recon_breaks_fund_id_status_idx`(`fund_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pay_recon_break_events` (
    `id` CHAR(36) NOT NULL,
    `break_id` CHAR(36) NOT NULL,
    `action` VARCHAR(24) NOT NULL,
    `from_status` VARCHAR(16) NULL,
    `to_status` VARCHAR(16) NULL,
    `actor_id` CHAR(36) NULL,
    `note` VARCHAR(1000) NULL,
    `detail` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pay_recon_break_events_break_id_created_at_idx`(`break_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pay_recon_break_events` ADD CONSTRAINT `pay_recon_break_events_break_id_fkey` FOREIGN KEY (`break_id`) REFERENCES `pay_recon_breaks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

