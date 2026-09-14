-- DO NOT APPLY without explicit approval from the project owner, after
-- production has been surveyed and the Entitlement backfill confirmed
-- correct against real production data (see FINDINGS.md's "Deployment
-- prerequisite" section for the survey script and procedure).
--
-- This is the real, final destruction of the pre-Entitlement trial data —
-- "subscriptions_legacy_20260914" (renamed from "subscriptions" by
-- 20260914055144_merge_subscription_into_entitlement, not dropped there,
-- per that ruling) and the enum type its status column used.
--
-- Sequenced as its own migration, deliberately left UNAPPLIED on every
-- database until someone runs it on purpose:
-- `npx prisma migrate resolve --applied 20260914_drop_subscriptions_legacy`
-- is the WRONG command here — that marks a migration done without running
-- it. To actually apply this one when the time comes, `prisma migrate
-- deploy` will pick it up like any other pending migration once it's the
-- next one in line.

ALTER TABLE "subscriptions_legacy_20260914" DROP CONSTRAINT IF EXISTS "subscriptions_user_id_fkey";

DROP TABLE "subscriptions_legacy_20260914";

DROP TYPE "SubscriptionStatus";
