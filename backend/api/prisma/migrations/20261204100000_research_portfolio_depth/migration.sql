-- Package S4: research depth, private-markets pipeline, saved views, IBOR refresh jobs, portfolio strategy and risk. Additive.

-- AlterTable
ALTER TABLE `portfolios` ADD COLUMN `risk_profile` VARCHAR(16) NULL,
    ADD COLUMN `strategy` VARCHAR(40) NULL;

-- CreateTable
CREATE TABLE `user_saved_views` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `scope` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `config` JSON NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_saved_views_user_id_scope_idx`(`user_id`, `scope`),
    UNIQUE INDEX `user_saved_views_user_id_scope_name_key`(`user_id`, `scope`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ibor_refresh_jobs` (
    `id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NULL,
    `active_key` VARCHAR(40) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
    `requested_by` CHAR(36) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `snapshot_id` CHAR(36) NULL,
    `result` JSON NULL,
    `error` VARCHAR(500) NULL,

    UNIQUE INDEX `ibor_refresh_jobs_active_key_key`(`active_key`),
    INDEX `ibor_refresh_jobs_status_requested_at_idx`(`status`, `requested_at`),
    INDEX `ibor_refresh_jobs_requested_by_requested_at_idx`(`requested_by`, `requested_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `research_valuations` (
    `id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `method` VARCHAR(16) NOT NULL DEFAULT 'DCF',
    `currency` CHAR(3) NOT NULL,
    `current_version` INTEGER NOT NULL DEFAULT 1,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `research_valuations_case_id_key`(`case_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `research_valuation_versions` (
    `id` CHAR(36) NOT NULL,
    `valuation_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `inputs` JSON NOT NULL,
    `result` JSON NOT NULL,
    `target_price` DECIMAL(20, 6) NOT NULL,
    `low_price` DECIMAL(20, 6) NOT NULL,
    `high_price` DECIMAL(20, 6) NOT NULL,
    `note` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `research_valuation_versions_valuation_id_version_key`(`valuation_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `research_entries` (
    `id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NULL,
    `kind` VARCHAR(10) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NULL,
    `event_date` DATE NULL,
    `trigger_text` VARCHAR(300) NULL,
    `impact` VARCHAR(10) NULL,
    `severity` VARCHAR(8) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'RECORDED',
    `resolved_at` DATETIME(3) NULL,
    `resolved_by` CHAR(36) NULL,
    `resolution_note` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `research_entries_security_id_created_at_idx`(`security_id`, `created_at`),
    INDEX `research_entries_case_id_idx`(`case_id`),
    INDEX `research_entries_kind_status_idx`(`kind`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `issuer_financials` (
    `id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `period` VARCHAR(16) NOT NULL,
    `period_type` VARCHAR(4) NOT NULL,
    `period_end` DATE NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `revenue` DECIMAL(24, 4) NULL,
    `ebitda` DECIMAL(24, 4) NULL,
    `net_income` DECIMAL(24, 4) NULL,
    `eps` DECIMAL(20, 6) NULL,
    `total_assets` DECIMAL(24, 4) NULL,
    `total_debt` DECIMAL(24, 4) NULL,
    `equity` DECIMAL(24, 4) NULL,
    `source` VARCHAR(120) NOT NULL,
    `as_of` DATE NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `issuer_financials_security_id_period_end_idx`(`security_id`, `period_end`),
    UNIQUE INDEX `issuer_financials_security_id_period_key`(`security_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `issuer_filings` (
    `id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `filing_type` VARCHAR(20) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `period` VARCHAR(16) NULL,
    `period_end` DATE NULL,
    `filed_on` DATE NOT NULL,
    `source` VARCHAR(120) NOT NULL,
    `source_url` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `issuer_filings_security_id_filed_on_idx`(`security_id`, `filed_on`),
    INDEX `issuer_filings_document_id_idx`(`document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_pipeline_deals` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `sponsor` VARCHAR(160) NOT NULL,
    `strategy` VARCHAR(24) NOT NULL,
    `vintage` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `proposed_amount` DECIMAL(20, 4) NOT NULL,
    `expected_close` DATE NULL,
    `stage` VARCHAR(12) NOT NULL DEFAULT 'SOURCED',
    `fair_value_level` INTEGER NULL,
    `valuation_date` DATE NULL,
    `fund_id` CHAR(36) NULL,
    `owner_id` CHAR(36) NOT NULL,
    `notes` VARCHAR(500) NULL,
    `decided_by` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_note` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pm_pipeline_deals_ref_key`(`ref`),
    INDEX `pm_pipeline_deals_stage_updated_at_idx`(`stage`, `updated_at`),
    INDEX `pm_pipeline_deals_owner_id_idx`(`owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_diligence_cases` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `deal_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `lead_id` CHAR(36) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `checklist` JSON NOT NULL,
    `findings` TEXT NULL,
    `recommendation` VARCHAR(24) NULL,
    `completed_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pm_diligence_cases_ref_key`(`ref`),
    INDEX `pm_diligence_cases_deal_id_idx`(`deal_id`),
    INDEX `pm_diligence_cases_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_cashflow_scenarios` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `deal_id` CHAR(36) NULL,
    `fund_id` CHAR(36) NULL,
    `name` VARCHAR(160) NOT NULL,
    `kind` VARCHAR(10) NOT NULL DEFAULT 'BASE',
    `currency` CHAR(3) NOT NULL,
    `flows` JSON NOT NULL,
    `metrics` JSON NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pm_cashflow_scenarios_ref_key`(`ref`),
    INDEX `pm_cashflow_scenarios_deal_id_idx`(`deal_id`),
    INDEX `pm_cashflow_scenarios_fund_id_idx`(`fund_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `portfolios_strategy_idx` ON `portfolios`(`strategy`);

-- CreateIndex
CREATE INDEX `portfolios_risk_profile_idx` ON `portfolios`(`risk_profile`);

-- AddForeignKey
ALTER TABLE `research_valuation_versions` ADD CONSTRAINT `research_valuation_versions_valuation_id_fkey` FOREIGN KEY (`valuation_id`) REFERENCES `research_valuations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

