-- Package S5: STOP_LIMIT orders and price override reason (FR-OMS-018), external NAV on NAV runs (FR-VAL-017). Additive.

-- AlterTable
ALTER TABLE `orders` MODIFY `order_type` VARCHAR(12) NOT NULL,
    ADD COLUMN `stop_price` DECIMAL(20, 6) NULL,
    ADD COLUMN `price_override_reason` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `nav_runs` ADD COLUMN `external_nav` DECIMAL(20, 4) NULL,
    ADD COLUMN `external_nav_source` VARCHAR(80) NULL,
    ADD COLUMN `external_nav_note` VARCHAR(255) NULL,
    ADD COLUMN `external_nav_by` CHAR(36) NULL,
    ADD COLUMN `external_nav_at` DATETIME(3) NULL;

-- FR-VAL-009: valuation.run and valuation.maker split out of valuation.view. Every admin role that holds valuation.view
-- keeps the ability to prepare and review (additive; the read-only auditor role is left read-only).
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT rp.`role_id`, p.`code` FROM `role_permissions` rp
JOIN `roles` r ON r.`id` = rp.`role_id`
JOIN (SELECT 'valuation.run' AS `code` UNION ALL SELECT 'valuation.maker') p
WHERE rp.`permission` = 'valuation.view' AND r.`portal` = 'admin' AND r.`key` <> 'auditor';
