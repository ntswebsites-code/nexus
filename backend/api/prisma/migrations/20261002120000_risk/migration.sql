-- CreateTable
CREATE TABLE `risk_limits` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `metric` VARCHAR(24) NOT NULL,
    `scope_type` VARCHAR(12) NOT NULL DEFAULT 'PORTFOLIO',
    `scope_id` CHAR(36) NULL,
    `threshold` DECIMAL(10, 4) NOT NULL,
    `unit` VARCHAR(8) NOT NULL DEFAULT 'PCT',
    `breach_action` VARCHAR(16) NOT NULL DEFAULT 'ALERT',
    `description` VARCHAR(500) NULL,
    `owner_user_id` CHAR(36) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `maker_id` CHAR(36) NOT NULL,
    `checker_id` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `retired_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `risk_limits_ref_key`(`ref`),
    INDEX `risk_limits_status_idx`(`status`),
    INDEX `risk_limits_scope_type_scope_id_idx`(`scope_type`, `scope_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_breaches` (
    `id` CHAR(36) NOT NULL,
    `limit_id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `detected_on` DATE NOT NULL,
    `value` DECIMAL(20, 6) NOT NULL,
    `threshold` DECIMAL(10, 4) NOT NULL,
    `detail` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `case_id` CHAR(36) NULL,
    `ack_by` CHAR(36) NULL,
    `ack_at` DATETIME(3) NULL,
    `ack_note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `risk_breaches_status_idx`(`status`),
    INDEX `risk_breaches_portfolio_id_detected_on_idx`(`portfolio_id`, `detected_on`),
    UNIQUE INDEX `risk_breaches_limit_id_portfolio_id_detected_on_key`(`limit_id`, `portfolio_id`, `detected_on`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_scenarios` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `shocks` JSON NOT NULL,
    `preset` VARCHAR(16) NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `risk_scenarios_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_scenario_runs` (
    `id` CHAR(36) NOT NULL,
    `scenario_id` CHAR(36) NOT NULL,
    `portfolio_id` CHAR(36) NOT NULL,
    `as_of` DATE NOT NULL,
    `results` JSON NOT NULL,
    `run_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `risk_scenario_runs_scenario_id_created_at_idx`(`scenario_id`, `created_at`),
    INDEX `risk_scenario_runs_portfolio_id_created_at_idx`(`portfolio_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_cases` (
    `id` CHAR(36) NOT NULL,
    `ref` VARCHAR(16) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `description` VARCHAR(2000) NOT NULL,
    `severity` VARCHAR(12) NOT NULL DEFAULT 'MEDIUM',
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `owner_user_id` CHAR(36) NULL,
    `source_breach_id` CHAR(36) NULL,
    `portfolio_id` CHAR(36) NULL,
    `resolution_note` VARCHAR(2000) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `risk_cases_ref_key`(`ref`),
    INDEX `risk_cases_status_severity_idx`(`status`, `severity`),
    INDEX `risk_cases_owner_user_id_idx`(`owner_user_id`),
    INDEX `risk_cases_source_breach_id_idx`(`source_breach_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `risk_breaches` ADD CONSTRAINT `risk_breaches_limit_id_fkey` FOREIGN KEY (`limit_id`) REFERENCES `risk_limits`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_scenario_runs` ADD CONSTRAINT `risk_scenario_runs_scenario_id_fkey` FOREIGN KEY (`scenario_id`) REFERENCES `risk_scenarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
