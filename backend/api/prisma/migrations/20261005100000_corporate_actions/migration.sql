-- CreateTable
CREATE TABLE `corp_action_events` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `ticker` VARCHAR(24) NOT NULL,
    `security_name` VARCHAR(200) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'ANNOUNCED',
    `currency` CHAR(3) NOT NULL,
    `ex_date` DATE NOT NULL,
    `record_date` DATE NOT NULL,
    `pay_date` DATE NOT NULL,
    `election_deadline` DATE NULL,
    `rate` DECIMAL(20, 8) NULL,
    `ratio_new` DECIMAL(14, 6) NULL,
    `ratio_old` DECIMAL(14, 6) NULL,
    `withholding_pct` DECIMAL(7, 4) NOT NULL DEFAULT 0,
    `target_security_id` CHAR(36) NULL,
    `target_ticker` VARCHAR(24) NULL,
    `default_option` VARCHAR(12) NULL,
    `description` VARCHAR(1000) NULL,
    `maker_id` CHAR(36) NOT NULL,
    `confirmed_by` CHAR(36) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `processed_by` CHAR(36) NULL,
    `processed_at` DATETIME(3) NULL,
    `cancelled_by` CHAR(36) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(1000) NULL,
    `entitlements_at` DATETIME(3) NULL,
    `detail` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `corp_action_events_ref_key`(`ref`),
    INDEX `corp_action_events_status_ex_date_idx`(`status`, `ex_date`),
    INDEX `corp_action_events_security_id_ex_date_idx`(`security_id`, `ex_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `corp_action_entitlements` (
    `id` CHAR(36) NOT NULL,
    `event_id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `option` VARCHAR(12) NULL,
    `elected` BOOLEAN NOT NULL DEFAULT false,
    `elected_by` CHAR(36) NULL,
    `elected_at` DATETIME(3) NULL,
    `gross_amount` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `tax_amount` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `cash_amount` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `shares_delta` DECIMAL(24, 6) NOT NULL DEFAULT 0,
    `target_shares` DECIMAL(24, 6) NOT NULL DEFAULT 0,
    `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `applied_at` DATETIME(3) NULL,
    `detail` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `corp_action_entitlements_portfolio_id_idx`(`portfolio_id`),
    UNIQUE INDEX `corp_action_entitlements_event_id_portfolio_id_key`(`event_id`, `portfolio_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `corp_action_entitlements` ADD CONSTRAINT `corp_action_entitlements_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `corp_action_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

