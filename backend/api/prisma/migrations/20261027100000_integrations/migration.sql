-- CreateTable
CREATE TABLE `integration_calls` (
    `id` CHAR(36) NOT NULL,
    `adapter` VARCHAR(32) NOT NULL,
    `mode` VARCHAR(8) NOT NULL,
    `operation` VARCHAR(48) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `status` VARCHAR(8) NOT NULL,
    `duration_ms` INTEGER NOT NULL,
    `request` JSON NULL,
    `result` JSON NULL,
    `error` VARCHAR(500) NULL,
    `correlation_id` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `integration_calls_adapter_created_at_idx`(`adapter`, `created_at`),
    INDEX `integration_calls_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_inbox` (
    `id` CHAR(36) NOT NULL,
    `adapter` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `external_ref` VARCHAR(80) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'NEW',
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,

    INDEX `integration_inbox_adapter_kind_status_idx`(`adapter`, `kind`, `status`),
    INDEX `integration_inbox_external_ref_idx`(`external_ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_state` (
    `adapter` VARCHAR(32) NOT NULL,
    `failure_mode` VARCHAR(8) NOT NULL DEFAULT 'none',
    `failures_remaining` INTEGER NOT NULL DEFAULT 0,
    `updated_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`adapter`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
