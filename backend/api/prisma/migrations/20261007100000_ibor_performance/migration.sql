-- CreateTable
CREATE TABLE `ibor_lots` (
    `id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `opened_on` DATE NOT NULL,
    `original_qty` DECIMAL(24, 6) NOT NULL,
    `remaining_qty` DECIMAL(24, 6) NOT NULL,
    `unit_cost` DECIMAL(20, 6) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `source_type` VARCHAR(12) NOT NULL,
    `source_id` VARCHAR(64) NOT NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'OPEN',
    `closed_on` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ibor_lots_portfolio_id_security_id_status_idx`(`portfolio_id`, `security_id`, `status`),
    UNIQUE INDEX `ibor_lots_portfolio_id_source_type_source_id_key`(`portfolio_id`, `source_type`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ibor_events` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NULL,
    `event_type` VARCHAR(12) NOT NULL,
    `quantity_delta` DECIMAL(24, 6) NULL,
    `price` DECIMAL(20, 6) NULL,
    `effective_date` DATE NOT NULL,
    `source_type` VARCHAR(16) NULL,
    `source_id` VARCHAR(64) NULL,
    `summary` VARCHAR(300) NOT NULL,
    `detail` JSON NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ibor_events_ref_key`(`ref`),
    INDEX `ibor_events_portfolio_id_created_at_idx`(`portfolio_id`, `created_at`),
    INDEX `ibor_events_security_id_idx`(`security_id`),
    UNIQUE INDEX `ibor_events_source_type_source_id_key`(`source_type`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ibor_snapshots` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NULL,
    `as_of` DATE NOT NULL,
    `status` VARCHAR(12) NOT NULL,
    `position_count` INTEGER NOT NULL,
    `market_value_base` DECIMAL(20, 4) NOT NULL,
    `events_ingested` INTEGER NOT NULL,
    `lots_opened` INTEGER NOT NULL,
    `adjustments` INTEGER NOT NULL,
    `exception_count` INTEGER NOT NULL,
    `summary` JSON NULL,
    `duration_ms` INTEGER NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ibor_snapshots_ref_key`(`ref`),
    INDEX `ibor_snapshots_portfolio_id_created_at_idx`(`portfolio_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `perf_benchmarks` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(24) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `perf_benchmarks_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `perf_benchmark_constituents` (
    `id` CHAR(36) NOT NULL,
    `benchmark_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NULL,
    `sector` VARCHAR(80) NOT NULL,
    `weight_pct` DECIMAL(9, 4) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `perf_benchmark_constituents_benchmark_id_idx`(`benchmark_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `perf_periods` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `benchmark_id` CHAR(36) NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `base_currency` CHAR(3) NOT NULL,
    `start_value` DECIMAL(20, 4) NOT NULL,
    `end_value` DECIMAL(20, 4) NOT NULL,
    `net_flows` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `twr_pct` DECIMAL(14, 6) NOT NULL,
    `benchmark_pct` DECIMAL(14, 6) NULL,
    `active_pct` DECIMAL(14, 6) NULL,
    `day_count` INTEGER NOT NULL,
    `series` JSON NOT NULL,
    `attribution` JSON NULL,
    `contributions` JSON NULL,
    `controls` JSON NULL,
    `navCheck` JSON NULL,
    `data_hash` VARCHAR(64) NOT NULL,
    `maker_id` CHAR(36) NOT NULL,
    `checker_id` CHAR(36) NULL,
    `locked_at` DATETIME(3) NULL,
    `lock_note` VARCHAR(500) NULL,
    `supersedes_id` CHAR(36) NULL,
    `correction_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `perf_periods_ref_key`(`ref`),
    INDEX `perf_periods_portfolio_id_status_idx`(`portfolio_id`, `status`),
    INDEX `perf_periods_benchmark_id_idx`(`benchmark_id`),
    UNIQUE INDEX `perf_periods_portfolio_id_period_start_period_end_version_key`(`portfolio_id`, `period_start`, `period_end`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `perf_benchmark_constituents` ADD CONSTRAINT `perf_benchmark_constituents_benchmark_id_fkey` FOREIGN KEY (`benchmark_id`) REFERENCES `perf_benchmarks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

