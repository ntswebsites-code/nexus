-- AlterTable
ALTER TABLE `sessions` ADD COLUMN `mfa_pending` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mfa_verified_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `roles` ADD COLUMN `custom` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `locked` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `user_mfa_factors` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'totp',
    `secret_enc` TEXT NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_mfa_factors_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitations` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `name` VARCHAR(120) NULL,
    `portal` VARCHAR(32) NOT NULL,
    `role_keys` JSON NOT NULL,
    `client_id` CHAR(36) NULL,
    `company_id` CHAR(36) NULL,
    `scope` VARCHAR(32) NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `invited_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invitations_token_hash_key`(`token_hash`),
    INDEX `invitations_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_resets` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_resets_token_hash_key`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policies` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(36) NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `owner_id` VARCHAR(36) NOT NULL,
    `key` VARCHAR(80) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`owner_id`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NULL,
    `link` VARCHAR(500) NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_idx`(`user_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `user_id` CHAR(36) NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`user_id`, `channel`, `type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actor_id` CHAR(36) NULL,
    `actor_role` VARCHAR(120) NULL,
    `portal` VARCHAR(32) NULL,
    `action` VARCHAR(80) NOT NULL,
    `object_type` VARCHAR(64) NOT NULL,
    `object_id` VARCHAR(64) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `reason` TEXT NULL,
    `ip` VARCHAR(45) NULL,
    `request_id` VARCHAR(64) NULL,
    `prev_hash` CHAR(64) NOT NULL,
    `hash` CHAR(64) NOT NULL,

    INDEX `audit_events_object_type_object_id_idx`(`object_type`, `object_id`),
    INDEX `audit_events_actor_id_occurred_at_idx`(`actor_id`, `occurred_at`),
    INDEX `audit_events_occurred_at_idx`(`occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(80) NOT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,

    INDEX `outbox_events_published_at_id_idx`(`published_at`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sequences` (
    `name` VARCHAR(32) NOT NULL,
    `value` INTEGER NOT NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `files` (
    `id` CHAR(36) NOT NULL,
    `storage_key` VARCHAR(200) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(120) NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `scan_status` VARCHAR(16) NOT NULL DEFAULT 'clean',
    `uploaded_by_id` CHAR(36) NULL,
    `application_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `files_storage_key_key`(`storage_key`),
    INDEX `files_application_id_idx`(`application_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `documents` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(32) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `label` VARCHAR(120) NULL,
    `classification` VARCHAR(16) NOT NULL DEFAULT 'Internal',
    `status` VARCHAR(24) NOT NULL DEFAULT 'Draft',
    `owner_name` VARCHAR(120) NULL,
    `related_type` VARCHAR(32) NULL,
    `related_id` CHAR(36) NULL,
    `related_label` VARCHAR(160) NULL,
    `client_id` CHAR(36) NULL,
    `company_id` CHAR(36) NULL,
    `year` INTEGER NULL,
    `document_date` DATETIME(3) NULL,
    `requires_signature` BOOLEAN NOT NULL DEFAULT false,
    `retention_years` INTEGER NOT NULL DEFAULT 7,
    `maker_id` CHAR(36) NULL,
    `checker_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(36) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `documents_ref_key`(`ref`),
    INDEX `documents_client_id_idx`(`client_id`),
    INDEX `documents_company_id_idx`(`company_id`),
    INDEX `documents_related_type_related_id_idx`(`related_type`, `related_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_versions` (
    `id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `file_id` CHAR(36) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `uploaded_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `document_versions_document_id_version_key`(`document_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `publications` (
    `id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_by_id` CHAR(36) NULL,
    `withdrawn_at` DATETIME(3) NULL,

    INDEX `publications_client_id_idx`(`client_id`),
    UNIQUE INDEX `publications_document_id_client_id_key`(`document_id`, `client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_reads` (
    `document_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`document_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signature_requests` (
    `id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Pending',
    `requested_by_id` CHAR(36) NULL,
    `due_date` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `signature_requests_client_id_status_idx`(`client_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `signatures` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `signer_user_id` CHAR(36) NOT NULL,
    `signer_name` VARCHAR(120) NOT NULL,
    `authority` VARCHAR(160) NOT NULL,
    `consent_at` DATETIME(3) NOT NULL,
    `mfa_at` DATETIME(3) NULL,
    `doc_sha256` CHAR(64) NOT NULL,
    `ip` VARCHAR(45) NULL,
    `signed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clients` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `base_currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `risk_rating` VARCHAR(16) NOT NULL DEFAULT 'Medium',
    `kyc_status` VARCHAR(24) NOT NULL DEFAULT 'Pending',
    `mandate_label` VARCHAR(120) NULL,
    `owner_name` VARCHAR(120) NULL,
    `relationship_owner_id` CHAR(36) NULL,
    `email` VARCHAR(254) NULL,
    `phone` VARCHAR(40) NULL,
    `registration_ref` VARCHAR(80) NULL,
    `address` VARCHAR(255) NULL,
    `notes` TEXT NULL,
    `value_label` VARCHAR(40) NULL,
    `accounts_count` INTEGER NOT NULL DEFAULT 0,
    `next_review_date` DATETIME(3) NULL,
    `portal_enabled` BOOLEAN NOT NULL DEFAULT false,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(36) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `clients_ref_key`(`ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_users` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `investor_role` VARCHAR(32) NOT NULL DEFAULT 'admin',
    `account_scope` VARCHAR(32) NOT NULL DEFAULT 'all',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `client_users_client_id_user_id_key`(`client_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mandates` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Shell',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `mandates_ref_key`(`ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_accounts` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `mandate_id` CHAR(36) NULL,
    `legal_entity` VARCHAR(200) NOT NULL,
    `ownership` VARCHAR(16) NOT NULL DEFAULT 'SEGREGATED',
    `money_class` VARCHAR(40) NOT NULL DEFAULT 'Client money',
    `type` VARCHAR(40) NOT NULL DEFAULT 'Settlement',
    `provider` VARCHAR(120) NOT NULL DEFAULT 'Pending',
    `identifier_enc` TEXT NULL,
    `masked` VARCHAR(40) NOT NULL DEFAULT 'Pending',
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `meta` JSON NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `maker_id` CHAR(36) NULL,
    `checker_id` CHAR(36) NULL,
    `submitted_at` DATETIME(3) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `cash_accounts_ref_key`(`ref`),
    INDEX `cash_accounts_client_id_idx`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_applications` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NULL,
    `channel` VARCHAR(32) NOT NULL DEFAULT 'Investor portal',
    `applicant_type` VARCHAR(64) NOT NULL DEFAULT 'Individual',
    `legal_name` VARCHAR(200) NULL,
    `email` VARCHAR(254) NOT NULL,
    `email_verified_at` DATETIME(3) NULL,
    `phone` VARCHAR(40) NULL,
    `country` VARCHAR(80) NULL,
    `registration_ref` VARCHAR(80) NULL,
    `expected_investment` DECIMAL(20, 4) NULL,
    `relationship` VARCHAR(80) NULL,
    `classification` VARCHAR(80) NULL,
    `base_currency` VARCHAR(8) NULL,
    `risk_profile` VARCHAR(40) NULL,
    `liquidity_need` VARCHAR(40) NULL,
    `purpose` TEXT NULL,
    `source_of_funds` TEXT NULL,
    `source_of_wealth` TEXT NULL,
    `tax_residence` VARCHAR(80) NULL,
    `tax_id_enc` TEXT NULL,
    `tax_status` VARCHAR(80) NULL,
    `pep` VARCHAR(16) NULL,
    `bank_jurisdiction` VARCHAR(80) NULL,
    `signing_authority` VARCHAR(160) NULL,
    `expected_activity` TEXT NULL,
    `form_data` JSON NULL,
    `consent_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Draft',
    `submitted_at` DATETIME(3) NULL,
    `draft_token_hash` CHAR(64) NULL,
    `draft_token_expires_at` DATETIME(3) NULL,
    `client_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `onboarding_applications_ref_key`(`ref`),
    UNIQUE INDEX `onboarding_applications_draft_token_hash_key`(`draft_token_hash`),
    INDEX `onboarding_applications_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `beneficial_owners` (
    `id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NULL,
    `client_id` CHAR(36) NULL,
    `full_name` VARCHAR(160) NOT NULL,
    `id_number_enc` TEXT NULL,
    `ownership_pct` DECIMAL(7, 4) NULL,
    `is_controller` BOOLEAN NOT NULL DEFAULT false,
    `pep` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_cases` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NULL,
    `stage` VARCHAR(24) NOT NULL DEFAULT 'Submitted',
    `risk` VARCHAR(16) NOT NULL DEFAULT 'Pending',
    `sla_state` VARCHAR(24) NOT NULL DEFAULT 'New',
    `sla_due_at` DATETIME(3) NULL,
    `owner_id` CHAR(36) NULL,
    `owner_name` VARCHAR(120) NOT NULL DEFAULT 'Client Services intake',
    `prepared_by_id` CHAR(36) NULL,
    `decision` VARCHAR(24) NULL,
    `decision_reason` TEXT NULL,
    `decided_by_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `enhanced_review_done_at` DATETIME(3) NULL,
    `funds_approved` BOOLEAN NOT NULL DEFAULT false,
    `checklist` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `kyc_cases_ref_key`(`ref`),
    UNIQUE INDEX `kyc_cases_application_id_key`(`application_id`),
    INDEX `kyc_cases_stage_idx`(`stage`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_evidence` (
    `id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NULL,
    `application_id` CHAR(36) NOT NULL,
    `slot` VARCHAR(16) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `file_id` CHAR(36) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Received',
    `reviewer_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `kyc_evidence_application_id_slot_key`(`application_id`, `slot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `screening_results` (
    `id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `outcome` VARCHAR(16) NOT NULL,
    `score` INTEGER NULL,
    `raw_ref` VARCHAR(120) NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_case_events` (
    `id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `title` VARCHAR(200) NOT NULL,
    `detail` TEXT NULL,
    `actor_id` CHAR(36) NULL,

    INDEX `kyc_case_events_case_id_at_idx`(`case_id`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `capital_events` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(24) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `investment_name` VARCHAR(160) NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `due_date` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Draft',
    `purpose` TEXT NULL,
    `breakdown` JSON NULL,
    `bank_text` VARCHAR(255) NULL,
    `evidence_name` VARCHAR(255) NULL,
    `notice_document_id` CHAR(36) NULL,
    `maker_id` CHAR(36) NULL,
    `checker_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `capital_events_ref_key`(`ref`),
    INDEX `capital_events_client_id_status_idx`(`client_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `funding_evidence` (
    `id` CHAR(36) NOT NULL,
    `capital_event_id` CHAR(36) NOT NULL,
    `file_id` CHAR(36) NOT NULL,
    `confirmed_by_id` CHAR(36) NOT NULL,
    `confirmed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `matched_at` DATETIME(3) NULL,
    `matched_by_id` CHAR(36) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_instructions` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `bank` VARCHAR(120) NOT NULL,
    `account_name` VARCHAR(160) NULL,
    `identifier_enc` TEXT NULL,
    `masked` VARCHAR(40) NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_requests` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `priority` VARCHAR(16) NOT NULL DEFAULT 'Normal',
    `title` VARCHAR(200) NOT NULL,
    `detail` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Open',
    `owner_name` VARCHAR(120) NOT NULL DEFAULT 'Client Services',
    `owner_id` CHAR(36) NULL,
    `progress` INTEGER NOT NULL DEFAULT 10,
    `sla_due_at` DATETIME(3) NULL,
    `file_id` CHAR(36) NULL,
    `opened_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `service_requests_ref_key`(`ref`),
    INDEX `service_requests_client_id_status_idx`(`client_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_request_events` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `title` VARCHAR(200) NOT NULL,
    `detail` TEXT NULL,
    `actor_id` CHAR(36) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_threads` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `owner_name` VARCHAR(120) NOT NULL,
    `owner_role` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `message_threads_client_id_idx`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` CHAR(36) NOT NULL,
    `thread_id` CHAR(36) NOT NULL,
    `author_id` CHAR(36) NULL,
    `author_name` VARCHAR(120) NOT NULL,
    `from_client` BOOLEAN NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `messages_thread_id_created_at_idx`(`thread_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_reads` (
    `thread_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`thread_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `investor_snapshots` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `valuation_date` DATE NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Draft',
    `reporting_currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `fx` JSON NOT NULL,
    `metrics` JSON NOT NULL,
    `activity` JSON NULL,
    `maker_id` CHAR(36) NULL,
    `checker_id` CHAR(36) NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    INDEX `investor_snapshots_client_id_status_idx`(`client_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `snapshot_investments` (
    `id` CHAR(36) NOT NULL,
    `snapshot_id` CHAR(36) NOT NULL,
    `key` VARCHAR(24) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `kind` VARCHAR(64) NOT NULL,
    `value` DECIMAL(20, 4) NOT NULL,
    `return_pct` DECIMAL(9, 4) NULL,
    `benchmark_pct` DECIMAL(9, 4) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `status` VARCHAR(64) NOT NULL,
    `commitment` DECIMAL(20, 4) NULL,
    `called` DECIMAL(20, 4) NULL,
    `unfunded` DECIMAL(20, 4) NULL,
    `distributions` DECIMAL(20, 4) NULL,
    `irr` DECIMAL(9, 4) NULL,
    `tvpi` DECIMAL(9, 4) NULL,
    `dpi` DECIMAL(9, 4) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `snapshot_holdings` (
    `id` CHAR(36) NOT NULL,
    `snapshot_id` CHAR(36) NOT NULL,
    `key` VARCHAR(24) NOT NULL,
    `security` VARCHAR(160) NOT NULL,
    `account` VARCHAR(120) NOT NULL,
    `asset` VARCHAR(64) NOT NULL,
    `quantity` VARCHAR(40) NOT NULL,
    `price` VARCHAR(40) NOT NULL,
    `value` DECIMAL(20, 4) NOT NULL,
    `weight_pct` DECIMAL(9, 4) NOT NULL,
    `ytd_pct` DECIMAL(9, 4) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `snapshot_transactions` (
    `id` CHAR(36) NOT NULL,
    `snapshot_id` CHAR(36) NOT NULL,
    `key` VARCHAR(24) NOT NULL,
    `trade_date` DATE NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `account` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` VARCHAR(40) NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `snapshot_performance_points` (
    `id` CHAR(36) NOT NULL,
    `snapshot_id` CHAR(36) NOT NULL,
    `range` VARCHAR(8) NOT NULL,
    `idx` INTEGER NOT NULL,
    `portfolio_pct` DECIMAL(9, 4) NOT NULL,
    `benchmark_pct` DECIMAL(9, 4) NULL,

    INDEX `snapshot_performance_points_snapshot_id_range_idx`(`snapshot_id`, `range`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `snapshot_allocation` (
    `id` CHAR(36) NOT NULL,
    `snapshot_id` CHAR(36) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `pct` DECIMAL(9, 4) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portfolio_companies` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `legal_name` VARCHAR(255) NOT NULL,
    `ticker` VARCHAR(16) NOT NULL,
    `sector` VARCHAR(120) NOT NULL,
    `country` VARCHAR(80) NOT NULL,
    `founded` INTEGER NULL,
    `employees` INTEGER NULL,
    `website` VARCHAR(255) NULL,
    `address` VARCHAR(255) NULL,
    `relationship` JSON NOT NULL,
    `contacts` JSON NOT NULL,
    `cash_runway` JSON NULL,
    `volume_series` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `portfolio_companies_ref_key`(`ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_users` (
    `company_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`company_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_kpis` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `key` VARCHAR(32) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `unit` VARCHAR(8) NOT NULL,
    `invert` BOOLEAN NOT NULL DEFAULT false,
    `prev` DECIMAL(20, 4) NOT NULL,
    `budget` DECIMAL(20, 4) NOT NULL,
    `series` JSON NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `company_kpis_company_id_key_key`(`company_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reporting_periods` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `label` VARCHAR(32) NOT NULL,
    `due_date` DATE NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `kpi_values` JSON NULL,
    `notes` TEXT NULL,
    `submitted_at` DATETIME(3) NULL,
    `submitted_by_id` CHAR(36) NULL,
    `reviewed_by_id` CHAR(36) NULL,
    `reviewer_name` VARCHAR(120) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `reporting_periods_company_id_period_key`(`company_id`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reporting_items` (
    `id` CHAR(36) NOT NULL,
    `period_id` CHAR(36) NOT NULL,
    `key` VARCHAR(32) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `detail` VARCHAR(255) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `accept` VARCHAR(80) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Due',
    `expires_at` DATETIME(3) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `reporting_items_period_id_key_key`(`period_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reporting_submissions` (
    `id` CHAR(36) NOT NULL,
    `item_id` CHAR(36) NOT NULL,
    `file_id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `size` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Draft',
    `uploaded_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reporting_questions` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `period_id` CHAR(36) NULL,
    `title` VARCHAR(200) NOT NULL,
    `from_name` VARCHAR(120) NOT NULL,
    `from_role` VARCHAR(120) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reporting_questions_ref_key`(`ref`),
    INDEX `reporting_questions_company_id_status_idx`(`company_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reporting_question_messages` (
    `id` CHAR(36) NOT NULL,
    `question_id` CHAR(36) NOT NULL,
    `author_id` CHAR(36) NULL,
    `author_name` VARCHAR(120) NOT NULL,
    `from_company` BOOLEAN NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `covenants` (
    `id` CHAR(36) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `key` VARCHAR(32) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `threshold` VARCHAR(120) NOT NULL,
    `actual` DECIMAL(20, 4) NOT NULL,
    `limit` DECIMAL(20, 4) NOT NULL,
    `unit` VARCHAR(8) NOT NULL,
    `headroom` VARCHAR(40) NOT NULL,
    `evidence` VARCHAR(16) NOT NULL DEFAULT 'current',
    `note` VARCHAR(255) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `covenants_company_id_key_key`(`company_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_mfa_factors` ADD CONSTRAINT `user_mfa_factors_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_resets` ADD CONSTRAINT `password_resets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_versions` ADD CONSTRAINT `document_versions_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `publications` ADD CONSTRAINT `publications_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_reads` ADD CONSTRAINT `document_reads_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signature_requests` ADD CONSTRAINT `signature_requests_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `signatures` ADD CONSTRAINT `signatures_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `signature_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_users` ADD CONSTRAINT `client_users_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_users` ADD CONSTRAINT `client_users_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mandates` ADD CONSTRAINT `mandates_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_accounts` ADD CONSTRAINT `cash_accounts_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `beneficial_owners` ADD CONSTRAINT `beneficial_owners_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `onboarding_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_cases` ADD CONSTRAINT `kyc_cases_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `onboarding_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_evidence` ADD CONSTRAINT `kyc_evidence_case_id_fkey` FOREIGN KEY (`case_id`) REFERENCES `kyc_cases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `screening_results` ADD CONSTRAINT `screening_results_case_id_fkey` FOREIGN KEY (`case_id`) REFERENCES `kyc_cases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_case_events` ADD CONSTRAINT `kyc_case_events_case_id_fkey` FOREIGN KEY (`case_id`) REFERENCES `kyc_cases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `capital_events` ADD CONSTRAINT `capital_events_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `funding_evidence` ADD CONSTRAINT `funding_evidence_capital_event_id_fkey` FOREIGN KEY (`capital_event_id`) REFERENCES `capital_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_instructions` ADD CONSTRAINT `bank_instructions_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_request_events` ADD CONSTRAINT `service_request_events_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `service_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_threads` ADD CONSTRAINT `message_threads_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_thread_id_fkey` FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_reads` ADD CONSTRAINT `message_reads_thread_id_fkey` FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `investor_snapshots` ADD CONSTRAINT `investor_snapshots_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `snapshot_investments` ADD CONSTRAINT `snapshot_investments_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `investor_snapshots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `snapshot_holdings` ADD CONSTRAINT `snapshot_holdings_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `investor_snapshots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `snapshot_transactions` ADD CONSTRAINT `snapshot_transactions_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `investor_snapshots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `snapshot_performance_points` ADD CONSTRAINT `snapshot_performance_points_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `investor_snapshots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `snapshot_allocation` ADD CONSTRAINT `snapshot_allocation_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `investor_snapshots`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_users` ADD CONSTRAINT `company_users_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `portfolio_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_users` ADD CONSTRAINT `company_users_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_kpis` ADD CONSTRAINT `company_kpis_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `portfolio_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reporting_periods` ADD CONSTRAINT `reporting_periods_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `portfolio_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reporting_items` ADD CONSTRAINT `reporting_items_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `reporting_periods`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reporting_submissions` ADD CONSTRAINT `reporting_submissions_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `reporting_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reporting_questions` ADD CONSTRAINT `reporting_questions_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `portfolio_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reporting_question_messages` ADD CONSTRAINT `reporting_question_messages_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `reporting_questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `covenants` ADD CONSTRAINT `covenants_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `portfolio_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

