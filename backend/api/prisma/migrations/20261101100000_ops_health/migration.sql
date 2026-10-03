-- CreateTable
CREATE TABLE `worker_heartbeats` (
    `instance_id` VARCHAR(64) NOT NULL,
    `host` VARCHAR(120) NULL,
    `started_at` DATETIME(3) NOT NULL,
    `last_beat_at` DATETIME(3) NOT NULL,
    `last_tick_ms` INTEGER NOT NULL DEFAULT 0,
    `ticks` INTEGER NOT NULL DEFAULT 0,
    `last_handled` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(500) NULL,

    INDEX `worker_heartbeats_last_beat_at_idx`(`last_beat_at`),
    PRIMARY KEY (`instance_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ops_alerts` (
    `id` CHAR(36) NOT NULL,
    `alert_key` VARCHAR(100) NOT NULL,
    `source` VARCHAR(16) NOT NULL,
    `severity` VARCHAR(10) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `detail` VARCHAR(500) NULL,
    `status` VARCHAR(14) NOT NULL DEFAULT 'OPEN',
    `occurrences` INTEGER NOT NULL DEFAULT 1,
    `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,
    `acked_by` CHAR(36) NULL,
    `acked_at` DATETIME(3) NULL,
    `ack_note` VARCHAR(500) NULL,
    `notified_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `ops_alerts_alert_key_key`(`alert_key`),
    INDEX `ops_alerts_status_severity_idx`(`status`, `severity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
