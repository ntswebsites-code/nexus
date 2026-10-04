-- Package S8: platform and ops tooling. Additive.

-- CreateTable
CREATE TABLE `document_retention_schedules` (
    `id` CHAR(36) NOT NULL,
    `doc_type` VARCHAR(32) NOT NULL DEFAULT '*',
    `classification` VARCHAR(16) NOT NULL DEFAULT '*',
    `retention_years` INTEGER NOT NULL,
    `basis` VARCHAR(300) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` CHAR(36) NOT NULL,
    `updated_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `document_retention_schedules_doc_type_classification_key`(`doc_type`, `classification`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
