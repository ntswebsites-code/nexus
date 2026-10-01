-- AlterTable
ALTER TABLE `bank_instructions` ADD COLUMN `currency` CHAR(3) NULL,
    ADD COLUMN `fund_id` CHAR(36) NULL,
    ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `label` VARCHAR(128) NULL,
    MODIFY `status` VARCHAR(24) NOT NULL DEFAULT 'Active';

-- AlterTable
ALTER TABLE `client_users` ADD COLUMN `fund_ids` JSON NULL,
    ADD COLUMN `invited_by_id` CHAR(36) NULL,
    ADD COLUMN `lp_role` VARCHAR(16) NULL,
    ADD COLUMN `revoked_at` DATETIME(3) NULL,
    ADD COLUMN `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE `clients` ADD COLUMN `accredited_investor` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `country` VARCHAR(80) NULL,
    ADD COLUMN `dealing_hold` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `hold_reason` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `company_users` ADD COLUMN `invited_by_id` CHAR(36) NULL,
    ADD COLUMN `last_active_at` DATETIME(3) NULL,
    ADD COLUMN `profile` VARCHAR(32) NOT NULL DEFAULT 'workspace_administrator',
    ADD COLUMN `signing_authority` JSON NULL,
    ADD COLUMN `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    ADD COLUMN `title` VARCHAR(120) NULL;

-- AlterTable
ALTER TABLE `documents` ADD COLUMN `category` VARCHAR(32) NULL,
    ADD COLUMN `fund_id` CHAR(36) NULL,
    ADD COLUMN `period` VARCHAR(16) NULL,
    ADD COLUMN `source_ref_id` CHAR(36) NULL,
    ADD COLUMN `source_type` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `funding_evidence` ADD COLUMN `allocation_id` CHAR(36) NULL,
    ADD COLUMN `amount_claimed` DECIMAL(20, 4) NULL,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `sha256` CHAR(64) NULL;

-- AlterTable
ALTER TABLE `message_threads` ADD COLUMN `fund_id` CHAR(36) NULL,
    ADD COLUMN `last_message_at` DATETIME(3) NULL,
    ADD COLUMN `linked_id` CHAR(36) NULL,
    ADD COLUMN `linked_type` VARCHAR(32) NULL,
    ADD COLUMN `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE `portfolio_companies` ADD COLUMN `fund_id` CHAR(36) NULL,
    ADD COLUMN `funding_stage` VARCHAR(40) NULL,
    ADD COLUMN `industry` VARCHAR(120) NULL,
    ADD COLUMN `letterhead` JSON NULL,
    ADD COLUMN `registration_number` VARCHAR(80) NULL,
    ADD COLUMN `reporting_currency` CHAR(3) NOT NULL DEFAULT 'USD',
    ADD COLUMN `status` VARCHAR(16) NOT NULL DEFAULT 'Active';

-- AlterTable
ALTER TABLE `reporting_periods` ADD COLUMN `closed_at` DATETIME(3) NULL,
    ADD COLUMN `period_end` DATE NULL,
    ADD COLUMN `period_start` DATE NULL,
    ADD COLUMN `period_type` VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
    ADD COLUMN `requested_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `service_requests` ADD COLUMN `assignee_id` CHAR(36) NULL,
    ADD COLUMN `fund_id` CHAR(36) NULL,
    ADD COLUMN `lp_status` VARCHAR(24) NULL;

-- AlterTable
ALTER TABLE `signature_requests` ADD COLUMN `subject_id` CHAR(36) NULL,
    ADD COLUMN `subject_type` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `signatures` ADD COLUMN `certificate_document_id` CHAR(36) NULL,
    ADD COLUMN `consent_hash` CHAR(64) NULL,
    ADD COLUMN `consent_text_version` VARCHAR(32) NULL,
    ADD COLUMN `session_id` CHAR(36) NULL,
    ADD COLUMN `user_agent` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `funds` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `short_name` VARCHAR(80) NOT NULL,
    `public_reference` VARCHAR(40) NULL,
    `operating_model` VARCHAR(32) NOT NULL DEFAULT 'PRIVATE_CAPITAL',
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `vintage` SMALLINT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Active',
    `portal_visible` BOOLEAN NOT NULL DEFAULT true,
    `default_share_class` VARCHAR(32) NULL,
    `valuation_status` VARCHAR(16) NOT NULL DEFAULT 'FINAL',
    `as_of_date` DATE NULL,
    `nav_per_unit` DECIMAL(20, 8) NULL,
    `total_nav` DECIMAL(20, 4) NULL,
    `dealing_rules_json` JSON NULL,
    `wiring_json` JSON NULL,
    `maker_id` CHAR(36) NULL,
    `checker_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `funds_ref_key`(`ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fund_commitments` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `commitment_amount` DECIMAL(20, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `effective_date` DATE NULL,
    `investor_account_ref` VARCHAR(64) NULL,
    `metrics_json` JSON NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    INDEX `fund_commitments_fund_id_idx`(`fund_id`),
    UNIQUE INDEX `fund_commitments_client_id_fund_id_key`(`client_id`, `fund_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lp_holdings` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `share_class_code` VARCHAR(32) NOT NULL DEFAULT 'DEFAULT',
    `units` DECIMAL(24, 8) NOT NULL,
    `nav_per_unit` DECIMAL(20, 8) NOT NULL,
    `account_value` DECIMAL(20, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `account_ref` VARCHAR(64) NULL,
    `as_of_date` DATE NOT NULL,
    `valuation_status` VARCHAR(16) NOT NULL DEFAULT 'FINAL',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `lp_holdings_client_id_fund_id_share_class_code_key`(`client_id`, `fund_id`, `share_class_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `capital_calls` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `call_no` INTEGER NOT NULL,
    `call_percent` DECIMAL(12, 6) NULL,
    `total_amount` DECIMAL(20, 4) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `due_date` DATE NOT NULL,
    `transaction_date` DATE NULL,
    `wire_json` JSON NULL,
    `wire_text` TEXT NULL,
    `purpose` TEXT NULL,
    `notice_document_id` CHAR(36) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `maker_id` CHAR(36) NULL,
    `checker_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `issued_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `capital_calls_ref_key`(`ref`),
    INDEX `capital_calls_status_idx`(`status`),
    UNIQUE INDEX `capital_calls_fund_id_call_no_key`(`fund_id`, `call_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `capital_call_allocations` (
    `id` CHAR(36) NOT NULL,
    `call_id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `commitment_id` CHAR(36) NOT NULL,
    `lp_legal_name_snapshot` VARCHAR(255) NOT NULL,
    `total_commitment_snapshot` DECIMAL(20, 4) NOT NULL,
    `uncalled_before_snapshot` DECIMAL(20, 4) NOT NULL,
    `call_amount` DECIMAL(20, 4) NOT NULL,
    `amount_paid` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    INDEX `capital_call_allocations_client_id_idx`(`client_id`),
    UNIQUE INDEX `capital_call_allocations_call_id_client_id_key`(`call_id`, `client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `capital_call_payments` (
    `id` CHAR(36) NOT NULL,
    `allocation_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(20, 4) NOT NULL,
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recorded_by_id` CHAR(36) NOT NULL,
    `bank_reference` VARCHAR(80) NULL,
    `confirmation_id` CHAR(36) NULL,

    INDEX `capital_call_payments_allocation_id_idx`(`allocation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `distributions` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `distribution_date` DATE NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `gross_amount` DECIMAL(20, 4) NOT NULL,
    `carry_amount` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `adjustments_amount` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `net_to_lps` DECIMAL(20, 4) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `maker_id` CHAR(36) NULL,
    `checker_id` CHAR(36) NULL,
    `issued_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `distributions_ref_key`(`ref`),
    INDEX `distributions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `distribution_allocations` (
    `id` CHAR(36) NOT NULL,
    `distribution_id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `commitment_id` CHAR(36) NOT NULL,
    `lp_legal_name_snapshot` VARCHAR(255) NOT NULL,
    `commitment_snapshot` DECIMAL(20, 4) NOT NULL,
    `paid_in_snapshot` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `gross_share` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `adjustments` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `share_amount` DECIMAL(20, 4) NOT NULL,
    `amount_paid` DECIMAL(20, 4) NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `destination_bank_account_id` CHAR(36) NULL,
    `document_id` CHAR(36) NULL,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    INDEX `distribution_allocations_client_id_idx`(`client_id`),
    UNIQUE INDEX `distribution_allocations_distribution_id_client_id_key`(`distribution_id`, `client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lp_notices` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `body` TEXT NOT NULL,
    `category` VARCHAR(32) NOT NULL DEFAULT 'GENERAL',
    `target_type` VARCHAR(16) NOT NULL DEFAULT 'ALL',
    `fund_id` CHAR(36) NULL,
    `client_id` CHAR(36) NULL,
    `user_id` CHAR(36) NULL,
    `share_class_code` VARCHAR(32) NULL,
    `requires_acknowledgement` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `published_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `published_by_id` CHAR(36) NULL,
    `approved_by_id` CHAR(36) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `lp_notices_ref_key`(`ref`),
    INDEX `lp_notices_status_published_at_idx`(`status`, `published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lp_notice_receipts` (
    `id` CHAR(36) NOT NULL,
    `notice_id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `delivered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `opened_at` DATETIME(3) NULL,
    `acknowledged_at` DATETIME(3) NULL,

    INDEX `lp_notice_receipts_client_id_idx`(`client_id`),
    UNIQUE INDEX `lp_notice_receipts_notice_id_user_id_key`(`notice_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lp_dealing_requests` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `share_class_code` VARCHAR(32) NOT NULL DEFAULT 'DEFAULT',
    `request_type` VARCHAR(16) NOT NULL,
    `input_mode` VARCHAR(8) NOT NULL DEFAULT 'AMOUNT',
    `redemption_mode` VARCHAR(8) NULL,
    `amount` DECIMAL(20, 4) NULL,
    `units` DECIMAL(24, 8) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `requested_dealing_date` DATE NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
    `estimate_id` CHAR(36) NULL,
    `estimate_json` JSON NULL,
    `payload_hash` CHAR(64) NULL,
    `bank_account_id` CHAR(36) NULL,
    `submitted_by_id` CHAR(36) NULL,
    `notes` TEXT NULL,
    `processed_by_id` CHAR(36) NULL,
    `approved_by_id` CHAR(36) NULL,
    `dealing_nav_per_unit` DECIMAL(20, 8) NULL,
    `units_allocated` DECIMAL(24, 8) NULL,
    `rejection_reason` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `lp_dealing_requests_ref_key`(`ref`),
    UNIQUE INDEX `lp_dealing_requests_estimate_id_key`(`estimate_id`),
    INDEX `lp_dealing_requests_client_id_fund_id_idx`(`client_id`, `fund_id`),
    INDEX `lp_dealing_requests_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dealing_estimates` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `fund_id` CHAR(36) NOT NULL,
    `estimate_type` VARCHAR(16) NOT NULL,
    `estimate_json` JSON NOT NULL,
    `payload_hash` CHAR(64) NOT NULL,
    `consumed_by_request_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `dealing_estimates_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NULL,
    `scope` VARCHAR(255) NOT NULL,
    `idem_key` VARCHAR(200) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `state` VARCHAR(16) NOT NULL DEFAULT 'IN_PROGRESS',
    `response_status` INTEGER NULL,
    `response_body` LONGTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `idempotency_keys_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `idempotency_keys_user_id_scope_idem_key_key`(`user_id`, `scope`, `idem_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_access_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `document_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `client_id` CHAR(36) NULL,
    `action` VARCHAR(16) NOT NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `document_access_log_document_id_idx`(`document_id`),
    INDEX `document_access_log_client_id_action_at_idx`(`client_id`, `action`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `request_attachments` (
    `id` VARCHAR(20) NOT NULL,
    `client_id` CHAR(36) NULL,
    `company_id` CHAR(36) NULL,
    `file_id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `size` INTEGER NOT NULL,
    `mime` VARCHAR(120) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `request_id` CHAR(36) NULL,
    `message_id` CHAR(36) NULL,
    `thread_message_id` CHAR(36) NULL,
    `uploaded_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `request_attachments_client_id_idx`(`client_id`),
    INDEX `request_attachments_request_id_idx`(`request_id`),
    INDEX `request_attachments_thread_message_id_idx`(`thread_message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `term_sheets` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `company_id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `version_no` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `investment_amount` DECIMAL(20, 4) NOT NULL,
    `valuation` DECIMAL(20, 4) NOT NULL,
    `equity_percentage` DECIMAL(5, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `key_terms` JSON NULL,
    `conditions` TEXT NULL,
    `timeline` TEXT NULL,
    `document_id` CHAR(36) NULL,
    `created_by_id` CHAR(36) NULL,
    `issued_by_id` CHAR(36) NULL,
    `approved_by_id` CHAR(36) NULL,
    `issued_at` DATETIME(3) NULL,
    `viewed_at` DATETIME(3) NULL,
    `signed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `term_sheets_ref_key`(`ref`),
    INDEX `term_sheets_company_id_status_idx`(`company_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `counterparties` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` VARCHAR(16) NOT NULL DEFAULT 'CUSTODIAN',
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `accounts` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `counterparties_ref_key`(`ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `counterparty_users` (
    `counterparty_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'submitter',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `invited_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `counterparty_users_user_id_idx`(`user_id`),
    PRIMARY KEY (`counterparty_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `counterparty_executions` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(20) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `trade_ref` VARCHAR(64) NOT NULL,
    `execution_at` DATETIME(3) NOT NULL,
    `account_ref` VARCHAR(64) NOT NULL,
    `ticker` VARCHAR(32) NOT NULL,
    `isin` VARCHAR(12) NULL,
    `side` VARCHAR(8) NOT NULL,
    `quantity` DECIMAL(24, 8) NOT NULL,
    `price` DECIMAL(20, 8) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `settlement_date` DATE NULL,
    `broker` VARCHAR(120) NULL,
    `note` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Received',
    `supersedes_id` CHAR(36) NULL,
    `supersede_reason` VARCHAR(255) NULL,
    `submitted_by_id` CHAR(36) NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `counterparty_executions_ref_key`(`ref`),
    INDEX `counterparty_executions_account_ref_execution_at_idx`(`account_ref`, `execution_at`),
    UNIQUE INDEX `counterparty_executions_counterparty_id_trade_ref_key`(`counterparty_id`, `trade_ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `counterparty_day_end_packages` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(20) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `account_ref` VARCHAR(64) NOT NULL,
    `statement_date` DATE NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `closing_cash` DECIMAL(20, 2) NOT NULL,
    `holdings_mv` DECIMAL(20, 2) NOT NULL,
    `trade_count` INTEGER NOT NULL,
    `file_id` CHAR(36) NULL,
    `sha256` CHAR(64) NULL,
    `note` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'Received',
    `supersedes_id` CHAR(36) NULL,
    `supersede_reason` VARCHAR(255) NULL,
    `submitted_by_id` CHAR(36) NOT NULL,
    `approved_by_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `counterparty_day_end_packages_ref_key`(`ref`),
    INDEX `counterparty_day_end_packages_account_ref_statement_date_idx`(`account_ref`, `statement_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `documents_fund_id_idx` ON `documents`(`fund_id`);

-- AddForeignKey
ALTER TABLE `fund_commitments` ADD CONSTRAINT `fund_commitments_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fund_commitments` ADD CONSTRAINT `fund_commitments_fund_id_fkey` FOREIGN KEY (`fund_id`) REFERENCES `funds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lp_holdings` ADD CONSTRAINT `lp_holdings_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lp_holdings` ADD CONSTRAINT `lp_holdings_fund_id_fkey` FOREIGN KEY (`fund_id`) REFERENCES `funds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `capital_calls` ADD CONSTRAINT `capital_calls_fund_id_fkey` FOREIGN KEY (`fund_id`) REFERENCES `funds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `capital_call_allocations` ADD CONSTRAINT `capital_call_allocations_call_id_fkey` FOREIGN KEY (`call_id`) REFERENCES `capital_calls`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `capital_call_allocations` ADD CONSTRAINT `capital_call_allocations_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `capital_call_allocations` ADD CONSTRAINT `capital_call_allocations_commitment_id_fkey` FOREIGN KEY (`commitment_id`) REFERENCES `fund_commitments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `capital_call_payments` ADD CONSTRAINT `capital_call_payments_allocation_id_fkey` FOREIGN KEY (`allocation_id`) REFERENCES `capital_call_allocations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `distributions` ADD CONSTRAINT `distributions_fund_id_fkey` FOREIGN KEY (`fund_id`) REFERENCES `funds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `distribution_allocations` ADD CONSTRAINT `distribution_allocations_distribution_id_fkey` FOREIGN KEY (`distribution_id`) REFERENCES `distributions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `distribution_allocations` ADD CONSTRAINT `distribution_allocations_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `distribution_allocations` ADD CONSTRAINT `distribution_allocations_commitment_id_fkey` FOREIGN KEY (`commitment_id`) REFERENCES `fund_commitments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lp_notice_receipts` ADD CONSTRAINT `lp_notice_receipts_notice_id_fkey` FOREIGN KEY (`notice_id`) REFERENCES `lp_notices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lp_dealing_requests` ADD CONSTRAINT `lp_dealing_requests_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lp_dealing_requests` ADD CONSTRAINT `lp_dealing_requests_fund_id_fkey` FOREIGN KEY (`fund_id`) REFERENCES `funds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `term_sheets` ADD CONSTRAINT `term_sheets_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `portfolio_companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counterparty_users` ADD CONSTRAINT `counterparty_users_counterparty_id_fkey` FOREIGN KEY (`counterparty_id`) REFERENCES `counterparties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counterparty_executions` ADD CONSTRAINT `counterparty_executions_counterparty_id_fkey` FOREIGN KEY (`counterparty_id`) REFERENCES `counterparties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counterparty_day_end_packages` ADD CONSTRAINT `counterparty_day_end_packages_counterparty_id_fkey` FOREIGN KEY (`counterparty_id`) REFERENCES `counterparties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

