-- R4-6 Onboarding portal: single-use magic links for resuming drafts.
CREATE TABLE `onboarding_resume_links` (
  `id` CHAR(36) NOT NULL,
  `application_id` CHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `request_ip` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `onboarding_resume_links_token_hash_key`(`token_hash`),
  INDEX `onboarding_resume_links_application_id_created_at_idx`(`application_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
