-- CreateTable
CREATE TABLE `investee_staff_reviews` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `area` VARCHAR(12) NOT NULL,
    `outcome` VARCHAR(8) NOT NULL,
    `note` VARCHAR(1000) NULL,
    `snapshot_sha256` CHAR(64) NOT NULL,
    `summary` JSON NOT NULL,
    `reviewer_id` CHAR(36) NOT NULL,
    `reviewer_name` VARCHAR(120) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `investee_staff_reviews_company_id_area_created_at_idx`(`company_id`, `area`, `created_at`),
    UNIQUE INDEX `investee_staff_reviews_company_id_area_snapshot_sha256_revie_key`(`company_id`, `area`, `snapshot_sha256`, `reviewer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_report_signoffs` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `period_id` CHAR(36) NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `esign_request_id` CHAR(36) NOT NULL,
    `esign_ref` VARCHAR(24) NOT NULL,
    `pack_sha256` CHAR(64) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'REQUESTED',
    `requested_by_id` CHAR(36) NOT NULL,
    `requested_by_name` VARCHAR(120) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signed_at` DATETIME(3) NULL,

    INDEX `investee_report_signoffs_company_id_period_idx`(`company_id`, `period`),
    UNIQUE INDEX `investee_report_signoffs_period_id_esign_request_id_key`(`period_id`, `esign_request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_mail_log` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `subject_type` VARCHAR(24) NOT NULL,
    `subject_id` VARCHAR(64) NOT NULL,
    `recipient` VARCHAR(254) NOT NULL,
    `subject` VARCHAR(300) NOT NULL,
    `dedupe_key` VARCHAR(160) NOT NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `message_id` VARCHAR(160) NULL,
    `transport` VARCHAR(12) NULL,
    `last_error` VARCHAR(300) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_mail_log_dedupe_key_key`(`dedupe_key`),
    INDEX `investee_mail_log_company_id_created_at_idx`(`company_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

