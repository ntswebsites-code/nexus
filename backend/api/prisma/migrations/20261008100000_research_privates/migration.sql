-- CreateTable
CREATE TABLE `research_cases` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `thesis` TEXT NOT NULL,
    `risks` TEXT NULL,
    `rating` VARCHAR(12) NOT NULL,
    `target_price` DECIMAL(20, 6) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `horizon_months` INTEGER NOT NULL DEFAULT 12,
    `conviction` INTEGER NOT NULL DEFAULT 3,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `analyst_id` CHAR(36) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `reviewer_id` CHAR(36) NULL,
    `published_at` DATETIME(3) NULL,
    `return_reason` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `research_cases_ref_key`(`ref`),
    INDEX `research_cases_security_id_status_idx`(`security_id`, `status`),
    INDEX `research_cases_status_updated_at_idx`(`status`, `updated_at`),
    INDEX `research_cases_analyst_id_idx`(`analyst_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `research_rating_changes` (
    `id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `rating` VARCHAR(12) NOT NULL,
    `target_price` DECIMAL(20, 6) NOT NULL,
    `conviction` INTEGER NOT NULL,
    `price_at_change` DECIMAL(20, 6) NULL,
    `note` VARCHAR(500) NULL,
    `changed_by` CHAR(36) NOT NULL,
    `approved_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `research_rating_changes_case_id_created_at_idx`(`case_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ic_meetings` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `scheduled_at` DATETIME(3) NOT NULL,
    `agenda` TEXT NULL,
    `quorum` INTEGER NOT NULL DEFAULT 3,
    `status` VARCHAR(12) NOT NULL DEFAULT 'SCHEDULED',
    `chair_id` CHAR(36) NULL,
    `minutes` TEXT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ic_meetings_ref_key`(`ref`),
    INDEX `ic_meetings_status_scheduled_at_idx`(`status`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ic_decisions` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `meeting_id` CHAR(36) NULL,
    `portfolio_id` CHAR(36) NULL,
    `security_id` CHAR(36) NOT NULL,
    `action` VARCHAR(8) NOT NULL,
    `quantity` DECIMAL(24, 6) NULL,
    `rationale` TEXT NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PROPOSED',
    `proposer_id` CHAR(36) NOT NULL,
    `opened_at` DATETIME(3) NULL,
    `votes_for` INTEGER NOT NULL DEFAULT 0,
    `votes_against` INTEGER NOT NULL DEFAULT 0,
    `votes_abstain` INTEGER NOT NULL DEFAULT 0,
    `ratified_by` CHAR(36) NULL,
    `ratified_at` DATETIME(3) NULL,
    `outcome_note` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ic_decisions_ref_key`(`ref`),
    INDEX `ic_decisions_status_created_at_idx`(`status`, `created_at`),
    INDEX `ic_decisions_case_id_idx`(`case_id`),
    INDEX `ic_decisions_meeting_id_idx`(`meeting_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ic_votes` (
    `id` CHAR(36) NOT NULL,
    `decision_id` CHAR(36) NOT NULL,
    `voter_id` CHAR(36) NOT NULL,
    `vote` VARCHAR(8) NOT NULL,
    `comment` VARCHAR(500) NULL,
    `cast_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ic_votes_decision_id_voter_id_key`(`decision_id`, `voter_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ic_decision_orders` (
    `id` CHAR(36) NOT NULL,
    `decision_id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `order_ref` VARCHAR(16) NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ic_decision_orders_order_id_idx`(`order_id`),
    UNIQUE INDEX `ic_decision_orders_decision_id_order_id_key`(`decision_id`, `order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_funds` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `manager` VARCHAR(160) NOT NULL,
    `strategy` VARCHAR(24) NOT NULL,
    `vintage` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    `notes` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pm_funds_ref_key`(`ref`),
    INDEX `pm_funds_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_commitments` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `committed_on` DATE NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pm_commitments_ref_key`(`ref`),
    INDEX `pm_commitments_portfolio_id_idx`(`portfolio_id`),
    UNIQUE INDEX `pm_commitments_fund_id_portfolio_id_key`(`fund_id`, `portfolio_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_cashflows` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `commitment_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `notice_date` DATE NOT NULL,
    `due_date` DATE NOT NULL,
    `paid_on` DATE NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'NOTICED',
    `note` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `settled_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pm_cashflows_ref_key`(`ref`),
    INDEX `pm_cashflows_commitment_id_status_idx`(`commitment_id`, `status`),
    INDEX `pm_cashflows_due_date_status_idx`(`due_date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_marks` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `commitment_id` CHAR(36) NOT NULL,
    `as_of` DATE NOT NULL,
    `nav` DECIMAL(20, 4) NOT NULL,
    `method` VARCHAR(16) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `note` VARCHAR(500) NULL,
    `maker_id` CHAR(36) NOT NULL,
    `approver_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `reject_reason` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pm_marks_ref_key`(`ref`),
    INDEX `pm_marks_commitment_id_as_of_idx`(`commitment_id`, `as_of`),
    INDEX `pm_marks_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pm_evidence` (
    `id` CHAR(36) NOT NULL,
    `mark_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `reference` VARCHAR(255) NULL,
    `note` VARCHAR(500) NULL,
    `added_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pm_evidence_mark_id_idx`(`mark_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_portfolios` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` VARCHAR(500) NULL,
    `cash_target_pct` DECIMAL(8, 4) NOT NULL DEFAULT 0,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `created_by` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `model_portfolios_ref_key`(`ref`),
    INDEX `model_portfolios_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `model_weights` (
    `id` CHAR(36) NOT NULL,
    `model_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `target_pct` DECIMAL(8, 4) NOT NULL,

    UNIQUE INDEX `model_weights_model_id_security_id_key`(`model_id`, `security_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pl_rebalances` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `model_id` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PROPOSED',
    `drift_threshold_pct` DECIMAL(8, 4) NOT NULL,
    `total_value_base` DECIMAL(20, 4) NOT NULL,
    `base_currency` CHAR(3) NOT NULL,
    `constraints` JSON NOT NULL,
    `turnover_pct` DECIMAL(8, 4) NOT NULL,
    `cash_after_pct` DECIMAL(8, 4) NOT NULL,
    `warnings` JSON NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pl_rebalances_ref_key`(`ref`),
    INDEX `pl_rebalances_portfolio_id_status_idx`(`portfolio_id`, `status`),
    INDEX `pl_rebalances_model_id_idx`(`model_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pl_rebalance_lines` (
    `id` CHAR(36) NOT NULL,
    `rebalance_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `side` VARCHAR(4) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `price` DECIMAL(20, 6) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `current_pct` DECIMAL(8, 4) NOT NULL,
    `target_pct` DECIMAL(8, 4) NOT NULL,
    `after_pct` DECIMAL(8, 4) NOT NULL,
    `notional_base` DECIMAL(20, 4) NOT NULL,
    `check_result` VARCHAR(8) NOT NULL,
    `checks` JSON NOT NULL,
    `order_id` CHAR(36) NULL,
    `order_ref` VARCHAR(16) NULL,

    INDEX `pl_rebalance_lines_rebalance_id_idx`(`rebalance_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fin_facilities` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `lender` VARCHAR(160) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `pool_id` CHAR(36) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `limit_amount` DECIMAL(20, 4) NOT NULL,
    `rate_pct` DECIMAL(8, 4) NOT NULL DEFAULT 0,
    `initial_ratio` DECIMAL(8, 4) NOT NULL DEFAULT 1.5,
    `maintenance_ratio` DECIMAL(8, 4) NOT NULL DEFAULT 1.25,
    `call_due_days` INTEGER NOT NULL DEFAULT 2,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `maker_id` CHAR(36) NOT NULL,
    `approver_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fin_facilities_ref_key`(`ref`),
    INDEX `fin_facilities_portfolio_id_status_idx`(`portfolio_id`, `status`),
    INDEX `fin_facilities_pool_id_idx`(`pool_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fin_movements` (
    `id` CHAR(36) NOT NULL,
    `facility_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(6) NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `value_date` DATE NOT NULL,
    `note` VARCHAR(255) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fin_movements_facility_id_value_date_idx`(`facility_id`, `value_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fin_pools` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fin_pools_ref_key`(`ref`),
    INDEX `fin_pools_portfolio_id_idx`(`portfolio_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fin_collateral_items` (
    `id` CHAR(36) NOT NULL,
    `pool_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'POSTED',
    `posted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `released_at` DATETIME(3) NULL,
    `created_by` CHAR(36) NOT NULL,

    INDEX `fin_collateral_items_pool_id_status_idx`(`pool_id`, `status`),
    INDEX `fin_collateral_items_security_id_idx`(`security_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fin_eligibility_rules` (
    `id` CHAR(36) NOT NULL,
    `asset_class` VARCHAR(24) NOT NULL,
    `market` VARCHAR(8) NOT NULL DEFAULT '',
    `eligible` BOOLEAN NOT NULL DEFAULT true,
    `haircut_pct` DECIMAL(8, 4) NOT NULL DEFAULT 0,
    `max_pool_pct` DECIMAL(8, 4) NULL,
    `note` VARCHAR(255) NULL,
    `updated_by` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fin_eligibility_rules_asset_class_market_key`(`asset_class`, `market`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fin_margin_calls` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `facility_id` CHAR(36) NOT NULL,
    `status` VARCHAR(14) NOT NULL DEFAULT 'ISSUED',
    `called_amount` DECIMAL(20, 4) NOT NULL,
    `drawn` DECIMAL(20, 4) NOT NULL,
    `eligible_value` DECIMAL(20, 4) NOT NULL,
    `coverage_ratio` DECIMAL(10, 4) NOT NULL,
    `due_at` DATETIME(3) NOT NULL,
    `issued_by` CHAR(36) NOT NULL,
    `acknowledged_by` CHAR(36) NULL,
    `acknowledged_at` DATETIME(3) NULL,
    `resolved_by` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolution` VARCHAR(500) NULL,
    `coverage_after` DECIMAL(10, 4) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fin_margin_calls_ref_key`(`ref`),
    INDEX `fin_margin_calls_facility_id_status_idx`(`facility_id`, `status`),
    INDEX `fin_margin_calls_status_due_at_idx`(`status`, `due_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `research_rating_changes` ADD CONSTRAINT `research_rating_changes_case_id_fkey` FOREIGN KEY (`case_id`) REFERENCES `research_cases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ic_decisions` ADD CONSTRAINT `ic_decisions_case_id_fkey` FOREIGN KEY (`case_id`) REFERENCES `research_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ic_decisions` ADD CONSTRAINT `ic_decisions_meeting_id_fkey` FOREIGN KEY (`meeting_id`) REFERENCES `ic_meetings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ic_votes` ADD CONSTRAINT `ic_votes_decision_id_fkey` FOREIGN KEY (`decision_id`) REFERENCES `ic_decisions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ic_decision_orders` ADD CONSTRAINT `ic_decision_orders_decision_id_fkey` FOREIGN KEY (`decision_id`) REFERENCES `ic_decisions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_commitments` ADD CONSTRAINT `pm_commitments_fund_id_fkey` FOREIGN KEY (`fund_id`) REFERENCES `pm_funds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_cashflows` ADD CONSTRAINT `pm_cashflows_commitment_id_fkey` FOREIGN KEY (`commitment_id`) REFERENCES `pm_commitments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_marks` ADD CONSTRAINT `pm_marks_commitment_id_fkey` FOREIGN KEY (`commitment_id`) REFERENCES `pm_commitments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pm_evidence` ADD CONSTRAINT `pm_evidence_mark_id_fkey` FOREIGN KEY (`mark_id`) REFERENCES `pm_marks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `model_weights` ADD CONSTRAINT `model_weights_model_id_fkey` FOREIGN KEY (`model_id`) REFERENCES `model_portfolios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pl_rebalances` ADD CONSTRAINT `pl_rebalances_model_id_fkey` FOREIGN KEY (`model_id`) REFERENCES `model_portfolios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pl_rebalance_lines` ADD CONSTRAINT `pl_rebalance_lines_rebalance_id_fkey` FOREIGN KEY (`rebalance_id`) REFERENCES `pl_rebalances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fin_movements` ADD CONSTRAINT `fin_movements_facility_id_fkey` FOREIGN KEY (`facility_id`) REFERENCES `fin_facilities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fin_collateral_items` ADD CONSTRAINT `fin_collateral_items_pool_id_fkey` FOREIGN KEY (`pool_id`) REFERENCES `fin_pools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fin_margin_calls` ADD CONSTRAINT `fin_margin_calls_facility_id_fkey` FOREIGN KEY (`facility_id`) REFERENCES `fin_facilities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

