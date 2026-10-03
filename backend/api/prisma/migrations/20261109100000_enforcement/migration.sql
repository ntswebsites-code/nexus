-- CreateTable
CREATE TABLE `gov_model_usage_io` (
    `id` CHAR(36) NOT NULL,
    `usage_id` CHAR(36) NOT NULL,
    `model_id` CHAR(36) NOT NULL,
    `purpose` VARCHAR(24) NOT NULL,
    `inputs` JSON NULL,
    `outputs` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gov_model_usage_io_usage_id_key`(`usage_id`),
    INDEX `gov_model_usage_io_model_id_created_at_idx`(`model_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gov_review_reminders` (
    `id` CHAR(36) NOT NULL,
    `review_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `sent_on` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `gov_review_reminders_review_id_kind_sent_on_key`(`review_id`, `kind`, `sent_on`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `numbering_overrides` (
    `kind` VARCHAR(40) NOT NULL,
    `pad` INTEGER NOT NULL,
    `updated_by` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dq_schedules` (
    `id` CHAR(36) NOT NULL,
    `rule_id` CHAR(36) NOT NULL,
    `cadence` VARCHAR(10) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `next_run_at` DATETIME(3) NOT NULL,
    `last_run_at` DATETIME(3) NULL,
    `last_run_ref` VARCHAR(16) NULL,
    `last_status` VARCHAR(6) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dq_schedules_rule_id_key`(`rule_id`),
    INDEX `dq_schedules_enabled_next_run_at_idx`(`enabled`, `next_run_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dq_exception_work` (
    `id` CHAR(36) NOT NULL,
    `exception_id` CHAR(36) NOT NULL,
    `owner_id` CHAR(36) NULL,
    `due_on` DATE NULL,
    `escalation_level` INTEGER NOT NULL DEFAULT 0,
    `escalated_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,
    `assigned_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dq_exception_work_exception_id_key`(`exception_id`),
    INDEX `dq_exception_work_owner_id_idx`(`owner_id`),
    INDEX `dq_exception_work_due_on_idx`(`due_on`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_lineage_edges` (
    `id` CHAR(36) NOT NULL,
    `from_dataset` VARCHAR(64) NOT NULL,
    `to_dataset` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `description` VARCHAR(300) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `data_lineage_edges_to_dataset_idx`(`to_dataset`),
    UNIQUE INDEX `data_lineage_edges_from_dataset_to_dataset_kind_key`(`from_dataset`, `to_dataset`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

