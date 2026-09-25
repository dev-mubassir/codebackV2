-- Admin rebuild, Gate 6: move the trial's definition into billing_plans.
--
-- The trial grant used a hardcoded 25 auto-reply credits (lib/igIdentity.js
-- TRIAL_AUTO_REPLY_CREDITS) while the TRIAL plan row said 0 — and the billing
-- summary showed customers the row's 0. From now on the trial grant READS the
-- TRIAL plan (credits and length), so an admin can edit it like any plan;
-- this sets the row to what the code actually granted. Only touches a row
-- still at the seeded 0, so it never overwrites an admin's edit.
--
-- REVERSE (manual):
--   UPDATE "billing_plans" SET "auto_reply_credits_per_cycle" = 0 WHERE "code" = 'TRIAL';

UPDATE "billing_plans"
SET "auto_reply_credits_per_cycle" = 25
WHERE "code" = 'TRIAL' AND COALESCE("auto_reply_credits_per_cycle", 0) = 0;
