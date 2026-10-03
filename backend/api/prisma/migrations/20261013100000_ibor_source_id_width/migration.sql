-- AlterTable
ALTER TABLE `ibor_lots` MODIFY `source_id` VARCHAR(80) NOT NULL;

-- AlterTable
ALTER TABLE `ibor_events` MODIFY `source_id` VARCHAR(80) NULL;
