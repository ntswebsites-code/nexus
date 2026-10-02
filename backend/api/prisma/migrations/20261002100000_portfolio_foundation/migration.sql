-- CreateTable
CREATE TABLE `portfolios` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `base_currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `client_id` CHAR(36) NULL,
    `manager_user_id` CHAR(36) NULL,
    `benchmark` VARCHAR(160) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Active',
    `mandate_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(36) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `portfolios_ref_key`(`ref`),
    INDEX `portfolios_status_idx`(`status`),
    INDEX `portfolios_client_id_idx`(`client_id`),
    INDEX `portfolios_manager_user_id_idx`(`manager_user_id`),
    INDEX `portfolios_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `securities` (
    `id` CHAR(36) NOT NULL,
    `ticker` VARCHAR(24) NOT NULL,
    `isin` VARCHAR(12) NULL,
    `name` VARCHAR(200) NOT NULL,
    `market` VARCHAR(8) NOT NULL,
    `asset_class` VARCHAR(24) NOT NULL DEFAULT 'Equity',
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `board_lot` INTEGER NOT NULL DEFAULT 1,
    `sector` VARCHAR(80) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `securities_ticker_key`(`ticker`),
    UNIQUE INDEX `securities_isin_key`(`isin`),
    INDEX `securities_market_status_idx`(`market`, `status`),
    INDEX `securities_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `security_prices` (
    `id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `price_date` DATE NOT NULL,
    `price` DECIMAL(20, 6) NOT NULL,
    `source` VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `security_prices_security_id_price_date_idx`(`security_id`, `price_date`),
    UNIQUE INDEX `security_prices_security_id_price_date_source_key`(`security_id`, `price_date`, `source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `positions` (
    `id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `avg_cost` DECIMAL(20, 6) NOT NULL,
    `as_of` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `positions_portfolio_id_as_of_idx`(`portfolio_id`, `as_of`),
    INDEX `positions_security_id_idx`(`security_id`),
    UNIQUE INDEX `positions_portfolio_id_security_id_as_of_key`(`portfolio_id`, `security_id`, `as_of`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_cash` (
    `id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `available` DECIMAL(20, 4) NOT NULL,
    `as_of` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `portfolio_cash_portfolio_id_as_of_idx`(`portfolio_id`, `as_of`),
    UNIQUE INDEX `portfolio_cash_portfolio_id_currency_as_of_key`(`portfolio_id`, `currency`, `as_of`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `brokers` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(254) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `brokers_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fx_rates` (
    `id` CHAR(36) NOT NULL,
    `from_currency` CHAR(3) NOT NULL,
    `to_currency` CHAR(3) NOT NULL,
    `rate_date` DATE NOT NULL,
    `rate` DECIMAL(20, 10) NOT NULL,
    `source` VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `fx_rates_from_currency_to_currency_rate_date_key`(`from_currency`, `to_currency`, `rate_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `security_prices` ADD CONSTRAINT `security_prices_security_id_fkey` FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `positions` ADD CONSTRAINT `positions_portfolio_id_fkey` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `positions` ADD CONSTRAINT `positions_security_id_fkey` FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `portfolio_cash` ADD CONSTRAINT `portfolio_cash_portfolio_id_fkey` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

