-- Package S1: operations controls (BR-063 control tasks, FR-OPS-015 corporate action stages). Additive.
ALTER TABLE `ops_tasks` ADD COLUMN `is_control` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `corp_action_events`
  ADD COLUMN `instructed_by` CHAR(36) NULL,
  ADD COLUMN `instructed_at` DATETIME(3) NULL,
  ADD COLUMN `reconciled_by` CHAR(36) NULL,
  ADD COLUMN `reconciled_at` DATETIME(3) NULL;
