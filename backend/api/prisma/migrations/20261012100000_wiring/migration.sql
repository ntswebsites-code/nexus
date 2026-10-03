-- Wiring: source reference on accounting journals (idempotent system journals) and Operations Control runbook tasks.
ALTER TABLE `acc_journals` ADD COLUMN `source_ref` VARCHAR(80) NULL;
CREATE UNIQUE INDEX `acc_journals_source_ref_key` ON `acc_journals`(`source_ref`);

CREATE TABLE `ops_tasks` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `area` VARCHAR(20) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `detail` VARCHAR(1000) NULL,
    `due_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `owner_id` CHAR(36) NULL,
    `depends_on_id` CHAR(36) NULL,
    `blocked_reason` VARCHAR(500) NULL,
    `link` VARCHAR(300) NULL,
    `source_ref` VARCHAR(80) NULL,
    `created_by` CHAR(36) NOT NULL,
    `completed_by` CHAR(36) NULL,
    `completed_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ops_tasks_ref_key`(`ref`),
    UNIQUE INDEX `ops_tasks_source_ref_key`(`source_ref`),
    INDEX `ops_tasks_status_due_at_idx`(`status`, `due_at`),
    INDEX `ops_tasks_area_status_idx`(`area`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
