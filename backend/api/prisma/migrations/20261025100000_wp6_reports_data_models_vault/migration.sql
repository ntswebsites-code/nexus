-- WP-6: reports (recipients, rolling windows, delivery), data fabric file ingestion, model reviews and bindings,
-- configurable KYC risk factors, client change requests, vault PM evidence link.

ALTER TABLE `report_schedules` ADD COLUMN `recipients` JSON NULL, ADD COLUMN `rolling` VARCHAR(24) NULL;
ALTER TABLE `report_runs` ADD COLUMN `delivered_at` DATETIME(3) NULL, ADD COLUMN `delivery_note` VARCHAR(300) NULL;
ALTER TABLE `data_sources` ADD COLUMN `schema_spec` JSON NULL;
ALTER TABLE `data_ingestion_jobs` ADD COLUMN `file_id` CHAR(36) NULL, ADD COLUMN `file_name` VARCHAR(255) NULL, ADD COLUMN `file_sha256` CHAR(64) NULL;
ALTER TABLE `data_quality_rules` MODIFY COLUMN `dataset` VARCHAR(64) NOT NULL;

CREATE TABLE `kyc_risk_factors` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(10) NOT NULL DEFAULT 'FACTOR',
    `label` VARCHAR(160) NOT NULL,
    `points` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `params` JSON NULL,
    `updated_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `kyc_risk_factors_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `client_change_requests` (
    `id` CHAR(36) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `target_id` CHAR(36) NULL,
    `to_value` VARCHAR(24) NOT NULL,
    `from_value` VARCHAR(24) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `maker_id` CHAR(36) NOT NULL,
    `checker_id` CHAR(36) NULL,
    `decision_note` VARCHAR(500) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `client_change_requests_status_created_at_idx`(`status`, `created_at`),
    INDEX `client_change_requests_client_id_status_idx`(`client_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `gov_model_reviews` (
    `id` CHAR(36) NOT NULL,
    `model_id` CHAR(36) NOT NULL,
    `due_on` DATE NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    `opened_by` CHAR(36) NOT NULL,
    `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewer_id` CHAR(36) NULL,
    `outcome` VARCHAR(16) NULL,
    `findings` VARCHAR(2000) NULL,
    `submitted_at` DATETIME(3) NULL,
    `approver_id` CHAR(36) NULL,
    `decision_note` VARCHAR(500) NULL,
    `next_review_on` DATE NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `gov_model_reviews_model_id_status_idx`(`model_id`, `status`),
    INDEX `gov_model_reviews_status_due_on_idx`(`status`, `due_on`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `gov_model_bindings` (
    `id` CHAR(36) NOT NULL,
    `purpose` VARCHAR(24) NOT NULL,
    `model_id` CHAR(36) NOT NULL,
    `enforce` BOOLEAN NOT NULL DEFAULT false,
    `updated_by` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `gov_model_bindings_purpose_key`(`purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `data_staged_records` (
    `id` CHAR(36) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `job_id` CHAR(36) NOT NULL,
    `row_no` INTEGER NOT NULL,
    `record_key` VARCHAR(80) NOT NULL,
    `data` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `data_staged_records_source_id_job_id_idx`(`source_id`, `job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `data_rejected_rows` (
    `id` CHAR(36) NOT NULL,
    `job_id` CHAR(36) NOT NULL,
    `row_no` INTEGER NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `raw` VARCHAR(1000) NOT NULL,

    INDEX `data_rejected_rows_job_id_idx`(`job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
