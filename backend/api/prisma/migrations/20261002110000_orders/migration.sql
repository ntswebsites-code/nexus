-- AlterTable
ALTER TABLE `securities` ADD COLUMN `average_daily_volume` DECIMAL(24, 2) NULL;

-- CreateTable
CREATE TABLE `orders` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `security_id` CHAR(36) NOT NULL,
    `side` VARCHAR(4) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `order_type` VARCHAR(8) NOT NULL,
    `limit_price` DECIMAL(20, 6) NULL,
    `tif` VARCHAR(8) NOT NULL DEFAULT 'DAY',
    `urgency` VARCHAR(8) NOT NULL DEFAULT 'Normal',
    `broker_id` CHAR(36) NULL,
    `rationale` TEXT NULL,
    `currency` CHAR(3) NOT NULL,
    `decision_price` DECIMAL(20, 6) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'Draft',
    `precheck_result` JSON NULL,
    `precheck_at` DATETIME(3) NULL,
    `maker_id` CHAR(36) NOT NULL,
    `approver_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `router_id` CHAR(36) NULL,
    `routed_at` DATETIME(3) NULL,
    `filled_qty` DECIMAL(24, 6) NOT NULL DEFAULT 0,
    `avg_price` DECIMAL(20, 6) NULL,
    `reserve_unit` DECIMAL(20, 8) NULL,
    `reserved_amount` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `estimated_fee` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `cancel_reason` VARCHAR(255) NULL,
    `reject_reason` VARCHAR(255) NULL,
    `submitted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `orders_ref_key`(`ref`),
    INDEX `orders_status_created_at_idx`(`status`, `created_at`),
    INDEX `orders_portfolio_id_status_idx`(`portfolio_id`, `status`),
    INDEX `orders_security_id_idx`(`security_id`),
    INDEX `orders_maker_id_idx`(`maker_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_fills` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `quantity` DECIMAL(24, 6) NOT NULL,
    `price` DECIMAL(20, 6) NOT NULL,
    `fees` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `executed_at` DATETIME(3) NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    `source_ref` VARCHAR(120) NULL,
    `recorded_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_fills_order_id_executed_at_idx`(`order_id`, `executed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_instructions` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `broker_id` CHAR(36) NOT NULL,
    `channel` VARCHAR(8) NOT NULL DEFAULT 'EMAIL',
    `payload` JSON NOT NULL,
    `sent_at` DATETIME(3) NULL,
    `delivery_status` VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `broker_instructions_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `order_fills` ADD CONSTRAINT `order_fills_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broker_instructions` ADD CONSTRAINT `broker_instructions_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

