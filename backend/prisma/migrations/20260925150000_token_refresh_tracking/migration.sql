-- Admin rebuild, Gate 3B: Instagram long-lived token auto-refresh tracking.
-- Additive, nullable; no backfill. The old code never reads these columns.
--
-- REVERSE (manual):
--   ALTER TABLE "instagram_accounts" DROP COLUMN "token_refreshed_at",
--     DROP COLUMN "token_refresh_failed_at", DROP COLUMN "token_refresh_error";

ALTER TABLE "instagram_accounts" ADD COLUMN "token_refreshed_at" TIMESTAMP(3);
ALTER TABLE "instagram_accounts" ADD COLUMN "token_refresh_failed_at" TIMESTAMP(3);
ALTER TABLE "instagram_accounts" ADD COLUMN "token_refresh_error" TEXT;
