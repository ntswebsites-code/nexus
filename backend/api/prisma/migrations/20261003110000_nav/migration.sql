-- NAV & Valuation. Additive: funds.portfolio_id (nullable logical link to portfolios.id, no FK) and the three NAV tables.
-- AlterTable
ALTER TABLE `funds` ADD COLUMN `portfolio_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `nav_runs` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `fund_id` CHAR(36) NULL,
    `nav_date` DATE NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `stage` VARCHAR(16) NOT NULL DEFAULT 'PRICES',
    `base_currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `market_value` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `cash` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `accruals` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `fees` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `liabilities` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `fee_rate_pct` DECIMAL(8, 4) NULL,
    `nav` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `units` DECIMAL(24, 6) NULL,
    `nav_per_unit` DECIMAL(20, 4) NULL,
    `price_coverage` DECIMAL(7, 4) NOT NULL DEFAULT 100,
    `position_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `maker_id` CHAR(36) NOT NULL,
    `reviewer_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `checker_id` CHAR(36) NULL,
    `released_at` DATETIME(3) NULL,
    `notes` VARCHAR(2000) NULL,
    `detail` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `nav_runs_ref_key`(`ref`),
    INDEX `nav_runs_portfolio_id_nav_date_idx`(`portfolio_id`, `nav_date`),
    INDEX `nav_runs_status_idx`(`status`),
    INDEX `nav_runs_fund_id_idx`(`fund_id`),
    UNIQUE INDEX `nav_runs_portfolio_id_nav_date_version_key`(`portfolio_id`, `nav_date`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nav_run_lines` (
    `id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `ticker` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `price` DECIMAL(20, 6) NULL,
    `price_source` VARCHAR(40) NULL,
    `price_date` DATE NULL,
    `fx_rate` DECIMAL(20, 10) NULL,
    `value_local` DECIMAL(20, 4) NULL,
    `value_base` DECIMAL(20, 4) NULL,
    `flags` JSON NULL,

    INDEX `nav_run_lines_run_id_idx`(`run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nav_exceptions` (
    `id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `security_id` CHAR(36) NULL,
    `ticker` VARCHAR(32) NULL,
    `detail` VARCHAR(500) NOT NULL,
    `current_value` DECIMAL(20, 4) NULL,
    `reference_value` DECIMAL(20, 4) NULL,
    `difference` DECIMAL(20, 4) NULL,
    `material` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `resolution` VARCHAR(1000) NULL,
    `evidence_ref` VARCHAR(200) NULL,
    `resolved_by` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `nav_exceptions_run_id_status_idx`(`run_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `nav_run_lines` ADD CONSTRAINT `nav_run_lines_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `nav_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nav_exceptions` ADD CONSTRAINT `nav_exceptions_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `nav_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
???????????????????????????????????????????????????????????
?  Update available 6.19.3 -> 8.0.0-rc.19                 ?
?                                                         ?
?  This is a major update - please follow the guide at    ?
?  https://pris.ly/d/major-version-upgrade                ?
?                                                         ?
?  Run the following to update                            ?
?    npm i --save-dev prisma@latest                       ?
?    npm i @prisma/client@latest                          ?
???????????????????????????????????????????????????????????

