-- WP-4 admin shell, security and notifications.
-- Existing tables: outbox_events gains row-claiming columns; notifications gains email routing status.
ALTER TABLE `outbox_events` ADD COLUMN `claimed_by` VARCHAR(64) NULL, ADD COLUMN `claimed_at` DATETIME(3) NULL, ADD COLUMN `next_attempt_at` DATETIME(3) NULL;
ALTER TABLE `notifications` ADD COLUMN `email_status` VARCHAR(16) NULL;
CREATE INDEX `notifications_user_id_email_status_idx` ON `notifications`(`user_id`, `email_status`);

CREATE TABLE `custom_permissions` (
    `code` VARCHAR(80) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_digest_logs` (
    `user_id` CHAR(36) NOT NULL,
    `period` VARCHAR(12) NOT NULL,
    `item_count` INTEGER NOT NULL,
    `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`user_id`, `period`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `job_locks` (
    `name` VARCHAR(64) NOT NULL,
    `locked_by` VARCHAR(64) NOT NULL,
    `locked_until` DATETIME(3) NOT NULL,
    `last_run_at` DATETIME(3) NULL,
    `last_result` JSON NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purge_runs` (
    `id` CHAR(36) NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `dry_run` BOOLEAN NOT NULL DEFAULT false,
    `result` JSON NULL,
    `triggered_by` VARCHAR(64) NULL,

    INDEX `purge_runs_started_at_idx`(`started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
