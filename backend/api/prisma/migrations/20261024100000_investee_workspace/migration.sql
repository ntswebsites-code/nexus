-- CreateTable
CREATE TABLE `investee_workspaces` (
    `company_id` CHAR(36) NOT NULL,
    `ledger_portfolio_id` CHAR(36) NULL,
    `forecast_scenario` VARCHAR(16) NOT NULL DEFAULT 'Base case',
    `legacy_migrated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`company_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_share_classes` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `voting` VARCHAR(60) NOT NULL DEFAULT '1 vote / share',
    `preference_multiple` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `participating` BOOLEAN NOT NULL DEFAULT false,
    `seniority` INTEGER NOT NULL DEFAULT 0,
    `conversion_ratio` DECIMAL(10, 4) NOT NULL DEFAULT 1,
    `status` VARCHAR(12) NOT NULL DEFAULT 'Active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_share_classes_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_shareholders` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `color` VARCHAR(9) NOT NULL DEFAULT '#6654e8',
    `status` VARCHAR(12) NOT NULL DEFAULT 'Active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_shareholders_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_cap_tx` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(14) NOT NULL,
    `status` VARCHAR(18) NOT NULL DEFAULT 'PENDING_APPROVAL',
    `holder_id` CHAR(36) NOT NULL,
    `from_holder_id` CHAR(36) NULL,
    `class_id` CHAR(36) NOT NULL,
    `shares` DECIMAL(20, 0) NOT NULL,
    `price_per_share` DECIMAL(20, 6) NULL,
    `consideration` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `effective_date` DATE NOT NULL,
    `note` VARCHAR(500) NULL,
    `maker_id` CHAR(36) NOT NULL,
    `maker_name` VARCHAR(120) NOT NULL,
    `checker_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `decision_note` VARCHAR(500) NULL,
    `gl_status` VARCHAR(10) NOT NULL DEFAULT 'NONE',
    `gl_ref` VARCHAR(16) NULL,
    `gl_note` VARCHAR(300) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_cap_tx_ref_key`(`ref`),
    INDEX `investee_cap_tx_company_id_status_idx`(`company_id`, `status`),
    INDEX `investee_cap_tx_company_id_effective_date_idx`(`company_id`, `effective_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_certificates` (
    `id` CHAR(36) NOT NULL,
    `cert_no` VARCHAR(16) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `tx_id` CHAR(36) NOT NULL,
    `holder_id` CHAR(36) NOT NULL,
    `class_id` CHAR(36) NOT NULL,
    `shares` DECIMAL(20, 0) NOT NULL,
    `issued_on` DATE NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `file_id` CHAR(36) NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'ISSUED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_certificates_cert_no_key`(`cert_no`),
    UNIQUE INDEX `investee_certificates_tx_id_key`(`tx_id`),
    INDEX `investee_certificates_company_id_holder_id_idx`(`company_id`, `holder_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_forecast_cells` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `metric` VARCHAR(24) NOT NULL DEFAULT 'revenue',
    `value` DECIMAL(20, 4) NOT NULL,
    `updated_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `investee_forecast_cells_company_id_period_metric_key`(`company_id`, `period`, `metric`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_forecast_locks` (
    `company_id` CHAR(36) NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `locked_by` CHAR(36) NOT NULL,
    `locked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`company_id`, `period`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_consents` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `basis` VARCHAR(160) NOT NULL,
    `submitted_on` DATE NOT NULL,
    `due_on` DATE NOT NULL,
    `owner_id` CHAR(36) NULL,
    `owner_name` VARCHAR(120) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Investor review',
    `note` VARCHAR(2000) NULL,
    `decided_by` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_consents_ref_key`(`ref`),
    INDEX `investee_consents_company_id_status_idx`(`company_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_board_meetings` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `meeting_at` DATETIME(3) NOT NULL,
    `location` VARCHAR(200) NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'SCHEDULED',
    `agenda` TEXT NULL,
    `minutes` TEXT NULL,
    `pack_status` VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    `pack_sha256` CHAR(64) NULL,
    `pack_published_at` DATETIME(3) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_board_meetings_ref_key`(`ref`),
    INDEX `investee_board_meetings_company_id_meeting_at_idx`(`company_id`, `meeting_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_board_pack_items` (
    `id` CHAR(36) NOT NULL,
    `meeting_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `label` VARCHAR(200) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `investee_board_pack_items_meeting_id_document_id_key`(`meeting_id`, `document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_board_actions` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `meeting_id` CHAR(36) NULL,
    `title` VARCHAR(200) NOT NULL,
    `owner_name` VARCHAR(120) NOT NULL,
    `due_on` DATE NULL,
    `evidence` VARCHAR(300) NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `investee_board_actions_company_id_status_idx`(`company_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_requisitions` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(180) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `amount` DECIMAL(20, 2) NOT NULL DEFAULT 0,
    `need_by` DATE NULL,
    `priority` VARCHAR(8) NOT NULL DEFAULT 'Medium',
    `status` VARCHAR(10) NOT NULL DEFAULT 'SUBMITTED',
    `note` VARCHAR(2000) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_by_name` VARCHAR(120) NOT NULL,
    `decided_by` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_requisitions_ref_key`(`ref`),
    INDEX `investee_requisitions_company_id_status_idx`(`company_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_sign_requests` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `message` VARCHAR(1000) NULL,
    `doc_sha256` CHAR(64) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_by_name` VARCHAR(120) NOT NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(300) NULL,
    `completed_at` DATETIME(3) NULL,
    `reminded_at` DATETIME(3) NULL,
    `reminder_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_sign_requests_ref_key`(`ref`),
    INDEX `investee_sign_requests_company_id_status_idx`(`company_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_signers` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `status` VARCHAR(9) NOT NULL DEFAULT 'PENDING',
    `signed_name` VARCHAR(120) NULL,
    `signed_at` DATETIME(3) NULL,
    `signed_ip` VARCHAR(64) NULL,
    `evidence_sha` CHAR(64) NULL,

    UNIQUE INDEX `investee_signers_token_hash_key`(`token_hash`),
    INDEX `investee_signers_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_share_links` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `recipient` VARCHAR(160) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `access_count` INTEGER NOT NULL DEFAULT 0,
    `last_access_at` DATETIME(3) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `investee_share_links_token_hash_key`(`token_hash`),
    INDEX `investee_share_links_company_id_document_id_idx`(`company_id`, `document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investee_access_reviews` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `reviewer_id` CHAR(36) NOT NULL,
    `reviewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `note` VARCHAR(500) NULL,
    `items` JSON NOT NULL,
    `mfa_covered` INTEGER NOT NULL,
    `mfa_total` INTEGER NOT NULL,

    INDEX `investee_access_reviews_company_id_reviewed_at_idx`(`company_id`, `reviewed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `investee_board_pack_items` ADD CONSTRAINT `investee_board_pack_items_meeting_id_fkey` FOREIGN KEY (`meeting_id`) REFERENCES `investee_board_meetings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `investee_signers` ADD CONSTRAINT `investee_signers_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `investee_sign_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

