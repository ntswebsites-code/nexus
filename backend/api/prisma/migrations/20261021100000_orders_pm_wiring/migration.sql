-- WP-2 orders, cash and private-markets wiring: realised gains on sells, PM postings, CA cash in lieu and reversal.
ALTER TABLE `pm_cashflows` ADD COLUMN `return_of_capital` DECIMAL(20, 4) NULL;
ALTER TABLE `pm_evidence` ADD COLUMN `document_id` CHAR(36) NULL;
ALTER TABLE `corp_action_events`
    ADD COLUMN `cash_in_lieu` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `cil_price` DECIMAL(20, 8) NULL,
    ADD COLUMN `reversed_by` CHAR(36) NULL,
    ADD COLUMN `reversed_at` DATETIME(3) NULL,
    ADD COLUMN `reverse_reason` VARCHAR(1000) NULL;
ALTER TABLE `corp_action_entitlements` ADD COLUMN `cash_in_lieu` DECIMAL(20, 4) NOT NULL DEFAULT 0;

CREATE TABLE `order_realised_gains` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `fill_id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `unit_cost` DECIMAL(20, 6) NOT NULL,
    `proceeds` DECIMAL(20, 4) NOT NULL,
    `cost_basis` DECIMAL(20, 4) NOT NULL,
    `fees` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `realised_gain` DECIMAL(20, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `method` VARCHAR(12) NOT NULL DEFAULT 'AVG_COST',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `order_realised_gains_fill_id_key`(`fill_id`),
    INDEX `order_realised_gains_order_id_idx`(`order_id`),
    INDEX `order_realised_gains_portfolio_id_created_at_idx`(`portfolio_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pm_postings` (
    `id` CHAR(36) NOT NULL,
    `source_ref` VARCHAR(80) NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `commitment_id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `cashflow_id` CHAR(36) NULL,
    `mark_id` CHAR(36) NULL,
    `currency` CHAR(3) NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `fx_rate` DECIMAL(20, 8) NOT NULL DEFAULT 1,
    `base_currency` CHAR(3) NOT NULL,
    `base_amount` DECIMAL(20, 4) NOT NULL,
    `carrying_delta` DECIMAL(20, 4) NOT NULL,
    `accounting_ref` VARCHAR(16) NULL,
    `cash_ref` VARCHAR(16) NULL,
    `skipped` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pm_postings_source_ref_key`(`source_ref`),
    INDEX `pm_postings_commitment_id_created_at_idx`(`commitment_id`, `created_at`),
    INDEX `pm_postings_portfolio_id_created_at_idx`(`portfolio_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
