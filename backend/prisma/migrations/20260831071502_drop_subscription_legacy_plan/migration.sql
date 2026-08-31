-- Backfill of subscriptions.plan_id from the legacy `plan` string column was
-- run and independently verified (all 4 existing rows, all "free" -> Starter)
-- before this migration was authored. See scripts/backfill-plans.js.

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "plan";
