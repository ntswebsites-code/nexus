-- Package S6: LP portal remainder. Additive.

-- CreateTable
CREATE TABLE `lp_fx_stamps` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `entry_id` VARCHAR(80) NOT NULL,
    `entry_type` VARCHAR(32) NOT NULL,
    `from_currency` CHAR(3) NOT NULL,
    `to_currency` CHAR(3) NOT NULL,
    `rate` DECIMAL(20, 10) NOT NULL,
    `rate_date` DATE NOT NULL,
    `txn_date` DATE NOT NULL,
    `source` VARCHAR(24) NOT NULL DEFAULT 'fx_rates',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lp_fx_stamps_client_id_idx`(`client_id`),
    UNIQUE INDEX `lp_fx_stamps_client_id_entry_id_to_currency_key`(`client_id`, `entry_id`, `to_currency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `benchmark_points` (
    `id` CHAR(36) NOT NULL,
    `benchmark_id` VARCHAR(32) NOT NULL,
    `metric` VARCHAR(32) NOT NULL,
    `point_date` DATE NOT NULL,
    `label` VARCHAR(40) NOT NULL,
    `value` DECIMAL(20, 6) NOT NULL,
    `source` VARCHAR(120) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `maker_id` CHAR(36) NOT NULL,
    `checker_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `benchmark_points_status_idx`(`status`),
    UNIQUE INDEX `benchmark_points_benchmark_id_metric_point_date_key`(`benchmark_id`, `metric`, `point_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_mfa_backup_codes` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_mfa_backup_codes_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_mfa_backup_codes` ADD CONSTRAINT `user_mfa_backup_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `bank_instructions` ADD COLUMN `supporting_letter_file_id` CHAR(36) NULL;
