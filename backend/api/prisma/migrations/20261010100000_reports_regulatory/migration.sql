-- CreateTable
CREATE TABLE `report_definitions` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(24) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `category` VARCHAR(24) NOT NULL,
    `param_spec` JSON NOT NULL,
    `formats` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `report_definitions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_runs` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `definition_id` CHAR(36) NOT NULL,
    `schedule_id` CHAR(36) NULL,
    `params` JSON NOT NULL,
    `format` VARCHAR(8) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'COMPLETED',
    `file_id` CHAR(36) NULL,
    `sha256` CHAR(64) NULL,
    `row_count` INTEGER NOT NULL DEFAULT 0,
    `title` VARCHAR(200) NOT NULL,
    `error` VARCHAR(500) NULL,
    `requested_by` CHAR(36) NOT NULL,
    `distributed_at` DATETIME(3) NULL,
    `distributed_by` CHAR(36) NULL,
    `document_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `report_runs_ref_key`(`ref`),
    INDEX `report_runs_definition_id_created_at_idx`(`definition_id`, `created_at`),
    INDEX `report_runs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_schedules` (
    `id` CHAR(36) NOT NULL,
    `definition_id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `params` JSON NOT NULL,
    `format` VARCHAR(8) NOT NULL,
    `frequency` VARCHAR(12) NOT NULL,
    `next_run_on` DATE NOT NULL,
    `last_run_at` DATETIME(3) NULL,
    `last_run_id` CHAR(36) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `report_schedules_active_next_run_on_idx`(`active`, `next_run_on`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reg_templates` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(32) NOT NULL,
    `regulator` VARCHAR(16) NOT NULL,
    `form_code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `frequency` VARCHAR(12) NOT NULL,
    `due_after_days` INTEGER NOT NULL DEFAULT 30,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reg_templates_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reg_filings` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `template_id` CHAR(36) NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `due_date` DATE NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `payload` JSON NULL,
    `populated_at` DATETIME(3) NULL,
    `notes` VARCHAR(1000) NULL,
    `return_reason` VARCHAR(500) NULL,
    `maker_id` CHAR(36) NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `submitted_by` CHAR(36) NULL,
    `submitted_at` DATETIME(3) NULL,
    `submission_ref` VARCHAR(80) NULL,
    `payload_sha256` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `reg_filings_ref_key`(`ref`),
    INDEX `reg_filings_status_due_date_idx`(`status`, `due_date`),
    UNIQUE INDEX `reg_filings_template_id_period_end_key`(`template_id`, `period_end`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reg_evidence` (
    `id` CHAR(36) NOT NULL,
    `filing_id` CHAR(36) NOT NULL,
    `file_id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` VARCHAR(300) NULL,
    `sha256` CHAR(64) NOT NULL,
    `uploaded_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reg_evidence_filing_id_idx`(`filing_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_sources` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `dataset` VARCHAR(40) NULL,
    `system` VARCHAR(80) NOT NULL,
    `owner` VARCHAR(120) NOT NULL,
    `cadence` VARCHAR(12) NOT NULL DEFAULT 'DAILY',
    `description` VARCHAR(500) NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
    `last_sync_at` DATETIME(3) NULL,
    `last_row_count` INTEGER NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `data_sources_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_ingestion_jobs` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `status` VARCHAR(10) NOT NULL,
    `rows_read` INTEGER NOT NULL DEFAULT 0,
    `rows_rejected` INTEGER NOT NULL DEFAULT 0,
    `latest_record_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,
    `error` VARCHAR(500) NULL,
    `triggered_by` CHAR(36) NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    UNIQUE INDEX `data_ingestion_jobs_ref_key`(`ref`),
    INDEX `data_ingestion_jobs_source_id_started_at_idx`(`source_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_quality_rules` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(60) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `source_id` CHAR(36) NULL,
    `dataset` VARCHAR(40) NOT NULL,
    `check_type` VARCHAR(12) NOT NULL,
    `col` VARCHAR(60) NOT NULL,
    `params` JSON NULL,
    `severity` VARCHAR(8) NOT NULL DEFAULT 'MEDIUM',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `data_quality_rules_key_key`(`key`),
    INDEX `data_quality_rules_dataset_idx`(`dataset`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_quality_runs` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `rule_id` CHAR(36) NOT NULL,
    `status` VARCHAR(6) NOT NULL,
    `rows_checked` INTEGER NOT NULL DEFAULT 0,
    `failures` INTEGER NOT NULL DEFAULT 0,
    `summary` VARCHAR(500) NULL,
    `ran_by` CHAR(36) NOT NULL,
    `ran_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `data_quality_runs_ref_key`(`ref`),
    INDEX `data_quality_runs_rule_id_ran_at_idx`(`rule_id`, `ran_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_quality_exceptions` (
    `id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `rule_id` CHAR(36) NOT NULL,
    `record_key` VARCHAR(80) NOT NULL,
    `detail` VARCHAR(300) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `resolution` VARCHAR(500) NULL,
    `resolved_by` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `data_quality_exceptions_rule_id_status_idx`(`rule_id`, `status`),
    INDEX `data_quality_exceptions_run_id_idx`(`run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gov_models` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `purpose` VARCHAR(600) NOT NULL,
    `model_type` VARCHAR(12) NOT NULL,
    `tier` INTEGER NOT NULL DEFAULT 2,
    `owner_name` VARCHAR(120) NOT NULL,
    `status` VARCHAR(14) NOT NULL DEFAULT 'DRAFT',
    `current_version_id` CHAR(36) NULL,
    `next_review_on` DATE NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `gov_models_ref_key`(`ref`),
    INDEX `gov_models_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gov_model_versions` (
    `id` CHAR(36) NOT NULL,
    `model_id` CHAR(36) NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `change_note` VARCHAR(1000) NOT NULL,
    `documentation` VARCHAR(300) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `author_id` CHAR(36) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `decision_note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gov_model_versions_model_id_version_key`(`model_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gov_model_validations` (
    `id` CHAR(36) NOT NULL,
    `version_id` CHAR(36) NOT NULL,
    `validator_id` CHAR(36) NOT NULL,
    `outcome` VARCHAR(20) NOT NULL,
    `scope` VARCHAR(300) NOT NULL,
    `findings` VARCHAR(2000) NULL,
    `evidence_ref` VARCHAR(200) NULL,
    `performed_on` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `gov_model_validations_version_id_idx`(`version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gov_model_usage` (
    `id` CHAR(36) NOT NULL,
    `model_id` CHAR(36) NOT NULL,
    `version_id` CHAR(36) NOT NULL,
    `context` VARCHAR(200) NOT NULL,
    `object_ref` VARCHAR(60) NULL,
    `note` VARCHAR(500) NULL,
    `used_by` CHAR(36) NOT NULL,
    `used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `gov_model_usage_model_id_used_at_idx`(`model_id`, `used_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `report_runs` ADD CONSTRAINT `report_runs_definition_id_fkey` FOREIGN KEY (`definition_id`) REFERENCES `report_definitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_schedules` ADD CONSTRAINT `report_schedules_definition_id_fkey` FOREIGN KEY (`definition_id`) REFERENCES `report_definitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reg_filings` ADD CONSTRAINT `reg_filings_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `reg_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reg_evidence` ADD CONSTRAINT `reg_evidence_filing_id_fkey` FOREIGN KEY (`filing_id`) REFERENCES `reg_filings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_ingestion_jobs` ADD CONSTRAINT `data_ingestion_jobs_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_quality_rules` ADD CONSTRAINT `data_quality_rules_source_id_fkey` FOREIGN KEY (`source_id`) REFERENCES `data_sources`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_quality_runs` ADD CONSTRAINT `data_quality_runs_rule_id_fkey` FOREIGN KEY (`rule_id`) REFERENCES `data_quality_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `data_quality_exceptions` ADD CONSTRAINT `data_quality_exceptions_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `data_quality_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gov_model_versions` ADD CONSTRAINT `gov_model_versions_model_id_fkey` FOREIGN KEY (`model_id`) REFERENCES `gov_models`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gov_model_validations` ADD CONSTRAINT `gov_model_validations_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `gov_model_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gov_model_usage` ADD CONSTRAINT `gov_model_usage_model_id_fkey` FOREIGN KEY (`model_id`) REFERENCES `gov_models`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

