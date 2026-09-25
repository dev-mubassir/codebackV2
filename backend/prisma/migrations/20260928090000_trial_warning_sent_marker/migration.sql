-- Additive only: one new nullable column, no change to existing rows.
--
-- Marks that the "your trial ends tomorrow" email has been claimed for a
-- tenant, so the hourly sweep sends it at most once no matter how many API
-- instances run the sweep, how often they restart, or whether two runs
-- overlap. Old code never reads it, so rolling back the app is safe.
ALTER TABLE "entitlements" ADD COLUMN "trial_warning_sent_at" TIMESTAMP(3);
