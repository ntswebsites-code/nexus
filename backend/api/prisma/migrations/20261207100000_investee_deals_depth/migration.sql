-- Package S7: investee and deals depth. Additive.

-- AlterTable
ALTER TABLE `investee_workspaces` ADD COLUMN `forecast_working_version` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `portfolio_companies` ADD COLUMN `total_committed_amount` DECIMAL(20, 4) NULL;

-- AlterTable
ALTER TABLE `investee_requisitions`
    MODIFY `status` VARCHAR(32) NOT NULL DEFAULT 'SUBMITTED',
    ADD COLUMN `fingerprint` CHAR(64) NULL,
    ADD COLUMN `submitted_at` DATETIME(3) NULL,
    ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `rfq_sent_at` DATETIME(3) NULL,
    ADD COLUMN `rfq_note` VARCHAR(500) NULL,
    ADD COLUMN `po_ref` VARCHAR(40) NULL,
    ADD COLUMN `converted_at` DATETIME(3) NULL;

-- Existing rows: submission time is creation time, approval time is the decision time.
UPDATE `investee_requisitions` SET `submitted_at` = `created_at` WHERE `status` <> 'DRAFT' AND `submitted_at` IS NULL;
UPDATE `investee_requisitions` SET `approved_at` = `decided_at` WHERE `status` IN ('APPROVED', 'FULFILLED') AND `approved_at` IS NULL;

-- CreateIndex
CREATE INDEX `investee_requisitions_status_submitted_at_idx` ON `investee_requisitions`(`status`, `submitted_at`);

-- AlterTable
ALTER TABLE `term_sheets`
    ADD COLUMN `parent_id` CHAR(36) NULL,
    ADD COLUMN `amendment_reason` VARCHAR(500) NULL,
    ADD COLUMN `close_reason` VARCHAR(500) NULL,
    ADD COLUMN `closed_by_id` CHAR(36) NULL,
    ADD COLUMN `closed_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `term_sheets_parent_id_idx` ON `term_sheets`(`parent_id`);

-- CreateTable
CREATE TABLE `investee_forecast_versions` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `version_no` INTEGER NOT NULL,
    `scenario` VARCHAR(16) NOT NULL,
    `data` JSON NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `submitted_by` CHAR(36) NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_forecast_versions_company_id_version_no_key`(`company_id`, `version_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_reserved_matters` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `detail` VARCHAR(400) NOT NULL DEFAULT '',
    `notice_days` INTEGER NOT NULL DEFAULT 14,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `investee_reserved_matters_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_deals` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `term_sheet_id` CHAR(36) NULL,
    `stage` VARCHAR(24) NOT NULL DEFAULT 'TERM_SHEET',
    `stage_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `investee_deals_ref_key`(`ref`),
    UNIQUE INDEX `investee_deals_term_sheet_id_key`(`term_sheet_id`),
    INDEX `investee_deals_company_id_stage_idx`(`company_id`, `stage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `term_sheet_templates` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(400) NULL,
    `key_terms` JSON NULL,
    `conditions` TEXT NULL,
    `timeline` TEXT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `term_sheet_templates_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
