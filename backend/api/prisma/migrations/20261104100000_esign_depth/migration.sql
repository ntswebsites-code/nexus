-- AlterTable
ALTER TABLE `esign_requests`
    ADD COLUMN `reminder_interval_days` INTEGER NULL,
    ADD COLUMN `reminder_max` INTEGER NULL,
    ADD COLUMN `bulk_batch_id` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `esign_requests_bulk_batch_id_idx` ON `esign_requests`(`bulk_batch_id`);

-- CreateTable
CREATE TABLE `esign_fields` (
    `id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `signer_id` CHAR(36) NOT NULL,
    `kind` VARCHAR(12) NOT NULL DEFAULT 'SIGNATURE',
    `page` INTEGER NOT NULL,
    `x` DOUBLE NOT NULL,
    `y` DOUBLE NOT NULL,
    `width` DOUBLE NOT NULL,
    `height` DOUBLE NOT NULL,
    `label` VARCHAR(80) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `esign_fields_request_id_page_idx`(`request_id`, `page`),
    INDEX `esign_fields_signer_id_idx`(`signer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `esign_batches` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `idempotency_key` VARCHAR(120) NOT NULL,
    `total` INTEGER NOT NULL,
    `created` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `failures` JSON NULL,
    `created_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `esign_batches_idempotency_key_key`(`idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `esign_fields` ADD CONSTRAINT `esign_fields_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `esign_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `esign_fields` ADD CONSTRAINT `esign_fields_signer_id_fkey` FOREIGN KEY (`signer_id`) REFERENCES `esign_signers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
