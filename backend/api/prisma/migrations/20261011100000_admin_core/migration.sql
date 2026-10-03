-- CreateTable
CREATE TABLE `access_change_requests` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `target_type` VARCHAR(8) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `target_label` VARCHAR(200) NOT NULL,
    `before` JSON NULL,
    `proposal` JSON NOT NULL,
    `privileged_by` JSON NULL,
    `privileged` BOOLEAN NOT NULL DEFAULT false,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `review_item_id` CHAR(36) NULL,
    `requested_by` CHAR(36) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decided_by` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_note` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `access_change_requests_ref_key`(`ref`),
    INDEX `access_change_requests_status_requested_at_idx`(`status`, `requested_at`),
    INDEX `access_change_requests_target_type_target_id_idx`(`target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_reviews` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `due_date` DATE NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    `opened_by` CHAR(36) NOT NULL,
    `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_by` CHAR(36) NULL,
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `access_reviews_ref_key`(`ref`),
    INDEX `access_reviews_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_review_items` (
    `id` CHAR(36) NOT NULL,
    `review_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `user_name` VARCHAR(200) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `roles` JSON NOT NULL,
    `permission_count` INTEGER NOT NULL,
    `mfa_enrolled` BOOLEAN NOT NULL,
    `last_login_at` DATETIME(3) NULL,
    `decision` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `decided_by` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `note` VARCHAR(500) NULL,
    `request_id` CHAR(36) NULL,

    UNIQUE INDEX `access_review_items_review_id_user_id_key`(`review_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_settings` (
    `key` VARCHAR(80) NOT NULL,
    `value` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updated_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_setting_changes` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `version` INTEGER NOT NULL,
    `before` JSON NULL,
    `after` JSON NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `changed_by` CHAR(36) NOT NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_setting_changes_key_changed_at_idx`(`key`, `changed_at`),
    INDEX `platform_setting_changes_changed_at_idx`(`changed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `copilot_queries` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `question` VARCHAR(500) NOT NULL,
    `intent` VARCHAR(40) NOT NULL,
    `answer` TEXT NOT NULL,
    `sources` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `copilot_queries_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `access_review_items` ADD CONSTRAINT `access_review_items_review_id_fkey` FOREIGN KEY (`review_id`) REFERENCES `access_reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

