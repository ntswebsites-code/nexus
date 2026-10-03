-- CreateTable
CREATE TABLE `esign_requests` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `message` VARCHAR(2000) NULL,
    `document_id` CHAR(36) NULL,
    `file_id` CHAR(36) NOT NULL,
    `original_sha256` CHAR(64) NOT NULL,
    `sealed_file_id` CHAR(36) NULL,
    `sealed_sha256` CHAR(64) NULL,
    `certificate_file_id` CHAR(36) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `signing_order` VARCHAR(12) NOT NULL DEFAULT 'PARALLEL',
    `subject_type` VARCHAR(40) NULL,
    `subject_id` VARCHAR(64) NULL,
    `client_id` CHAR(36) NULL,
    `company_id` CHAR(36) NULL,
    `chain_head` CHAR(64) NULL,
    `expires_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(500) NULL,
    `decline_reason` VARCHAR(500) NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `esign_requests_ref_key`(`ref`),
    INDEX `esign_requests_status_expires_at_idx`(`status`, `expires_at`),
    INDEX `esign_requests_subject_type_subject_id_idx`(`subject_type`, `subject_id`),
    INDEX `esign_requests_client_id_idx`(`client_id`),
    INDEX `esign_requests_company_id_idx`(`company_id`),
    INDEX `esign_requests_document_id_idx`(`document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `esign_signers` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `order_no` INTEGER NOT NULL DEFAULT 1,
    `kind` VARCHAR(12) NOT NULL,
    `user_id` CHAR(36) NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `role_label` VARCHAR(160) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'WAITING',
    `token_hash` CHAR(64) NULL,
    `token_expires_at` DATETIME(3) NULL,
    `otp_hash` CHAR(64) NULL,
    `otp_expires_at` DATETIME(3) NULL,
    `otp_attempts` INTEGER NOT NULL DEFAULT 0,
    `identity_method` VARCHAR(16) NULL,
    `identity_verified_at` DATETIME(3) NULL,
    `mfa_at` DATETIME(3) NULL,
    `notified_at` DATETIME(3) NULL,
    `reminder_count` INTEGER NOT NULL DEFAULT 0,
    `viewed_at` DATETIME(3) NULL,
    `signed_at` DATETIME(3) NULL,
    `declined_at` DATETIME(3) NULL,
    `decline_reason` VARCHAR(500) NULL,
    `signature_mode` VARCHAR(8) NULL,
    `signature_text` VARCHAR(160) NULL,
    `signature_image` MEDIUMTEXT NULL,
    `signature_hash` CHAR(64) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `consent_text_version` VARCHAR(32) NULL,
    `consent_hash` CHAR(64) NULL,
    `doc_sha256` CHAR(64) NULL,
    `chain_hash` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `esign_signers_token_hash_key`(`token_hash`),
    INDEX `esign_signers_user_id_status_idx`(`user_id`, `status`),
    INDEX `esign_signers_request_id_order_no_idx`(`request_id`, `order_no`),
    UNIQUE INDEX `esign_signers_request_id_email_key`(`request_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `esign_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `request_id` CHAR(36) NOT NULL,
    `signer_id` CHAR(36) NULL,
    `type` VARCHAR(24) NOT NULL,
    `actor_id` CHAR(36) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `detail` JSON NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `prev_hash` CHAR(64) NOT NULL,
    `hash` CHAR(64) NOT NULL,

    INDEX `esign_events_request_id_id_idx`(`request_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `esign_signers` ADD CONSTRAINT `esign_signers_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `esign_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `esign_events` ADD CONSTRAINT `esign_events_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `esign_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

