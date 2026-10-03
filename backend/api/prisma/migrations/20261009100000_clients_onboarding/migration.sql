-- CreateTable
CREATE TABLE `kyc_checks` (
    `id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `outcome` VARCHAR(8) NOT NULL,
    `provider` VARCHAR(80) NOT NULL DEFAULT 'Manual review',
    `notes` TEXT NULL,
    `performed_by` CHAR(36) NOT NULL,
    `performed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `kyc_checks_case_id_kind_performed_at_idx`(`case_id`, `kind`, `performed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_risk_assessments` (
    `id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `score` INTEGER NOT NULL,
    `factors` JSON NOT NULL,
    `proposed_rating` VARCHAR(16) NOT NULL,
    `rationale` TEXT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PROPOSED',
    `maker_id` CHAR(36) NOT NULL,
    `checker_id` CHAR(36) NULL,
    `decision_note` VARCHAR(500) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `kyc_risk_assessments_case_id_status_idx`(`case_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_sla_policies` (
    `id` CHAR(36) NOT NULL,
    `request_type` VARCHAR(64) NOT NULL,
    `priority` VARCHAR(16) NOT NULL,
    `target_hours` INTEGER NOT NULL,
    `updated_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_sla_policies_request_type_priority_key`(`request_type`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_changes` (
    `id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `from_value` VARCHAR(32) NOT NULL,
    `to_value` VARCHAR(32) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `maker_id` CHAR(36) NOT NULL,
    `checker_id` CHAR(36) NULL,
    `decision_note` VARCHAR(500) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_changes_document_id_status_idx`(`document_id`, `status`),
    INDEX `document_changes_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_holds` (
    `id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `placed_by` CHAR(36) NOT NULL,
    `placed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `released_by` CHAR(36) NULL,
    `released_at` DATETIME(3) NULL,
    `release_note` VARCHAR(500) NULL,

    INDEX `document_holds_document_id_released_at_idx`(`document_id`, `released_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

