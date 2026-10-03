-- Reconciliation depth and operations control: three new families (POSITIONS_VS_CUSTODY is 20 characters), tolerances,
-- custodian position and corporate-action feeds, evidence, queries and escalations, sign-off voids, runbook comments.

-- Widen the family columns (existing tables).
ALTER TABLE `recon_runs` MODIFY `family` VARCHAR(32) NOT NULL;
ALTER TABLE `recon_breaks` MODIFY `family` VARCHAR(32) NOT NULL;
ALTER TABLE `recon_signoffs` MODIFY `family` VARCHAR(32) NOT NULL;

CREATE TABLE `recon_tolerances` (
    `id` CHAR(36) NOT NULL,
    `family` VARCHAR(32) NOT NULL,
    `scope` VARCHAR(36) NOT NULL DEFAULT '*',
    `counterparty_id` CHAR(36) NULL,
    `effective_from` DATE NOT NULL,
    `price` DECIMAL(20, 6) NULL,
    `cash` DECIMAL(20, 2) NULL,
    `holdings_pct` DECIMAL(9, 4) NULL,
    `position_qty` DECIMAL(24, 8) NULL,
    `settle_days` INTEGER NULL,
    `ca_cash` DECIMAL(20, 2) NULL,
    `note` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recon_tolerances_family_effective_from_idx`(`family`, `effective_from`),
    UNIQUE INDEX `recon_tol_family_scope_from_key`(`family`, `scope`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `recon_custody_positions` (
    `id` CHAR(36) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `account_ref` VARCHAR(64) NOT NULL,
    `as_of_date` DATE NOT NULL,
    `ticker` VARCHAR(32) NOT NULL,
    `isin` VARCHAR(12) NULL,
    `quantity` DECIMAL(24, 8) NOT NULL,
    `batch_ref` VARCHAR(20) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recon_custody_positions_as_of_date_idx`(`as_of_date`),
    UNIQUE INDEX `recon_cust_pos_key`(`counterparty_id`, `account_ref`, `as_of_date`, `ticker`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `recon_custody_ca_notices` (
    `id` CHAR(36) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `account_ref` VARCHAR(64) NOT NULL,
    `ticker` VARCHAR(32) NOT NULL,
    `ca_type` VARCHAR(20) NULL,
    `ex_date` DATE NOT NULL,
    `pay_date` DATE NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `cash_amount` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL,
    `external_ref` VARCHAR(64) NULL,
    `batch_ref` VARCHAR(20) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recon_cust_ca_idx`(`counterparty_id`, `account_ref`, `pay_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `recon_source_receipts` (
    `id` CHAR(36) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `account_ref` VARCHAR(64) NOT NULL,
    `as_of_date` DATE NOT NULL,
    `feed` VARCHAR(16) NOT NULL,
    `row_count` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `file_id` CHAR(36) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `note` VARCHAR(500) NULL,
    `received_by` CHAR(36) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recon_src_receipt_key`(`counterparty_id`, `account_ref`, `as_of_date`, `feed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `recon_break_evidence` (
    `id` CHAR(36) NOT NULL,
    `break_id` CHAR(36) NOT NULL,
    `file_id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(120) NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `note` VARCHAR(500) NULL,
    `uploaded_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recon_break_evidence_break_id_idx`(`break_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `recon_break_actions` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `break_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `counterparty_id` CHAR(36) NULL,
    `subject` VARCHAR(200) NOT NULL,
    `body` VARCHAR(2000) NOT NULL,
    `level` INTEGER NULL,
    `to_user_id` CHAR(36) NULL,
    `raised_by` CHAR(36) NOT NULL,
    `raised_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `responded_by` CHAR(36) NULL,
    `responded_at` DATETIME(3) NULL,
    `response` VARCHAR(2000) NULL,

    UNIQUE INDEX `recon_break_actions_ref_key`(`ref`),
    INDEX `recon_break_actions_break_id_idx`(`break_id`),
    INDEX `recon_break_actions_kind_status_idx`(`kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `recon_signoff_voids` (
    `id` CHAR(36) NOT NULL,
    `original_id` CHAR(36) NOT NULL,
    `scope_key` VARCHAR(190) NOT NULL,
    `family` VARCHAR(32) NOT NULL,
    `as_of_date` DATE NOT NULL,
    `counterparty_id` CHAR(36) NULL,
    `signed_by` CHAR(36) NOT NULL,
    `signed_at` DATETIME(3) NOT NULL,
    `note` VARCHAR(1000) NULL,
    `summary` JSON NULL,
    `voided_by` CHAR(36) NOT NULL,
    `voided_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reason` VARCHAR(500) NOT NULL,
    `break_id` CHAR(36) NULL,

    INDEX `recon_signoff_voids_family_as_of_date_idx`(`family`, `as_of_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ops_task_comments` (
    `id` CHAR(36) NOT NULL,
    `task_id` CHAR(36) NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `author_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ops_task_comments_task_id_created_at_idx`(`task_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
