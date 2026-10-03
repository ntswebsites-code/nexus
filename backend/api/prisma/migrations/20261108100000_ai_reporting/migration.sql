-- AlterTable
ALTER TABLE `report_schedules` ADD COLUMN `email_attach` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `lp_deliver` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `lp_deliver_approved_by` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `copilot_queries` ADD COLUMN `copilot_tool_calls` JSON NULL,
    ADD COLUMN `copilot_engine` VARCHAR(12) NULL;

-- CreateTable
CREATE TABLE `reg_filing_submissions` (
    `id` CHAR(36) NOT NULL,
    `filing_id` CHAR(36) NOT NULL,
    `regulator` VARCHAR(16) NOT NULL,
    `form_code` VARCHAR(32) NOT NULL,
    `payload_sha256` CHAR(64) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `receipt_ref` VARCHAR(80) NOT NULL,
    `received_at` DATETIME(3) NOT NULL,
    `submitted_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reg_filing_submissions_filing_id_idx`(`filing_id`),
    UNIQUE INDEX `reg_filing_submissions_filing_id_receipt_ref_key`(`filing_id`, `receipt_ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_triages` (
    `id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `risk_band` VARCHAR(8) NOT NULL,
    `summary` TEXT NOT NULL,
    `flags` JSON NOT NULL,
    `next_steps` JSON NOT NULL,
    `model` VARCHAR(60) NOT NULL,
    `input_sha256` CHAR(64) NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `onboarding_triages_case_id_created_at_idx`(`case_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
