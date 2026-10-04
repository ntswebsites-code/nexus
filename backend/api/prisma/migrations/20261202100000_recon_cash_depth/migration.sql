-- Package S2: reconciliation and cash depth (FR-REC-006, FR-REC-017, FR-FIN-002, FR-FIN-004). Additive.

-- CreateTable
CREATE TABLE `counterpart_imports` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(20) NOT NULL,
    `source` VARCHAR(12) NOT NULL,
    `connector` VARCHAR(40) NULL,
    `feed` VARCHAR(16) NOT NULL,
    `counterparty_id` CHAR(36) NOT NULL,
    `account_ref` VARCHAR(64) NOT NULL,
    `as_of_date` DATE NOT NULL,
    `filename` VARCHAR(200) NOT NULL,
    `format` VARCHAR(12) NOT NULL,
    `record_count` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `file_id` CHAR(36) NULL,
    `receipt_id` CHAR(36) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'RECEIVED',
    `note` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `counterpart_imports_ref_key`(`ref`),
    INDEX `cp_import_scope_idx`(`counterparty_id`, `account_ref`, `as_of_date`, `feed`),
    INDEX `counterpart_imports_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `recon_breaks` ADD COLUMN `accepted_candidate` JSON NULL;

-- AlterTable
ALTER TABLE `fin_margin_calls`
  ADD COLUMN `disposition_kind` VARCHAR(20) NULL,
  ADD COLUMN `disposition_outcome` VARCHAR(16) NULL,
  ADD COLUMN `disposition_reason` VARCHAR(500) NULL,
  ADD COLUMN `disposition_by` CHAR(36) NULL,
  ADD COLUMN `disposition_at` DATETIME(3) NULL,
  ADD COLUMN `prior_status` VARCHAR(14) NULL,
  ADD COLUMN `counterparty_evidence_ref` VARCHAR(255) NULL,
  ADD COLUMN `house_calc_amount` DECIMAL(20, 4) NULL,
  ADD COLUMN `house_calc_note` VARCHAR(1000) NULL,
  ADD COLUMN `funding_ledger_id` CHAR(36) NULL,
  ADD COLUMN `funding_amount` DECIMAL(20, 4) NULL,
  ADD COLUMN `expectation_id` CHAR(36) NULL,
  ADD COLUMN `journal_id` CHAR(36) NULL;
