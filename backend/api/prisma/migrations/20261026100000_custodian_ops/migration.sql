-- Custodian ops: bulk execution batches, execution status history, amend/cancel markers, day-end control totals.
ALTER TABLE `counterparty_executions`
    ADD COLUMN `batch_id` CHAR(36) NULL,
    ADD COLUMN `cancelled_at` DATETIME(3) NULL,
    ADD COLUMN `amend_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `amended_at` DATETIME(3) NULL;
CREATE INDEX `counterparty_executions_batch_id_idx` ON `counterparty_executions`(`batch_id`);

ALTER TABLE `counterparty_day_end_packages`
    ADD COLUMN `trade_quantity` DECIMAL(24, 8) NULL,
    ADD COLUMN `trade_notional` DECIMAL(24, 2) NULL;

CREATE TABLE `custodian_execution_batches` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(20) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `file_id` CHAR(36) NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `row_count` INTEGER NOT NULL,
    `accepted_count` INTEGER NOT NULL,
    `duplicate_count` INTEGER NOT NULL,
    `rejected_count` INTEGER NOT NULL,
    `declared_count` INTEGER NULL,
    `declared_quantity` DECIMAL(24, 8) NULL,
    `declared_notional` DECIMAL(24, 2) NULL,
    `actual_quantity` DECIMAL(24, 8) NOT NULL,
    `actual_notional` DECIMAL(24, 2) NOT NULL,
    `control_status` VARCHAR(10) NOT NULL,
    `status` VARCHAR(10) NOT NULL,
    `errors` JSON NULL,
    `submitted_by_id` CHAR(36) NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `custodian_execution_batches_ref_key`(`ref`),
    INDEX `custodian_execution_batches_counterparty_id_submitted_at_idx`(`counterparty_id`, `submitted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `custodian_execution_events` (
    `id` CHAR(36) NOT NULL,
    `execution_id` CHAR(36) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `from_status` VARCHAR(16) NULL,
    `to_status` VARCHAR(16) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `changes` JSON NULL,
    `actor_type` VARCHAR(12) NOT NULL,
    `actor_id` CHAR(36) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `custodian_execution_events_execution_id_at_idx`(`execution_id`, `at`),
    INDEX `custodian_execution_events_counterparty_id_at_idx`(`counterparty_id`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
