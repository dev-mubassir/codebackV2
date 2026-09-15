-- Fold the trial-only Subscription model into Entitlement, per the decision
-- to extend Subscription rather than run two parallel per-tenant rows. See
-- the model comment on Entitlement in schema.prisma for the full rationale.
--
-- Field mapping (no data is discarded):
--   Subscription.status         -> Entitlement.status (NONE/TRIALING as-is; TRIAL_EXPIRED -> EXPIRED)
--   Subscription.trialStartedAt -> Entitlement.cycleStartedAt
--   Subscription.trialEndsAt    -> Entitlement.validUntil
--   plan_code is set to 'TRIAL' for any row that ever had a trial
--   (TRIALING or TRIAL_EXPIRED); left NULL for NONE rows, which never
--   picked a plan. billing_region/currency stay NULL — no region was ever
--   locked pre-billing.
--
-- "subscriptions" is RENAMED to "subscriptions_legacy_20260914" below, not
-- dropped — ruling: do not destroy it until production has been verified
-- against it. The real DROP TABLE is its own separate, unapplied migration
-- that waits for explicit approval.
--
-- REVERSE MIGRATION (manual, not scripted): rename
-- "subscriptions_legacy_20260914" back to "subscriptions" (data is intact,
-- nothing to recreate), and delete the rows this migration inserted into
-- "entitlements" (identifiable as the ones with no Order/CreditLedger
-- history). The 'NONE' value added to EntitlementStatus by the prior
-- migration cannot be un-added (Postgres has no DROP VALUE) regardless of
-- whether this migration itself is reversed.

-- entitlements.plan_code/billing_region/currency become nullable: NONE and
-- TRIALING entitlements have neither a plan nor a locked region/currency.
ALTER TABLE "entitlements" ALTER COLUMN "plan_code" DROP NOT NULL;
ALTER TABLE "entitlements" ALTER COLUMN "billing_region" DROP NOT NULL;
ALTER TABLE "entitlements" ALTER COLUMN "currency" DROP NOT NULL;
ALTER TABLE "entitlements" ALTER COLUMN "status" SET DEFAULT 'NONE';

-- Backfill. Guarded by NOT EXISTS so this migration is safe to have run
-- twice against the same database (it never will under normal deploy, but
-- costs nothing to make idempotent).
INSERT INTO "entitlements" (
  "id", "user_id", "plan_code", "billing_region", "currency", "status",
  "valid_until", "grace_until",
  "reply_credits_current", "reply_credits_banked",
  "classification_count_cycle", "classification_count_hour",
  "hour_window_started_at", "cycle_started_at",
  "extra_ig_accounts", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  s."user_id",
  CASE WHEN s."status" IN ('TRIALING', 'TRIAL_EXPIRED') THEN 'TRIAL' ELSE NULL END,
  NULL,
  NULL,
  (CASE s."status"
    WHEN 'TRIALING' THEN 'TRIALING'
    WHEN 'TRIAL_EXPIRED' THEN 'EXPIRED'
    ELSE 'NONE'
  END)::"EntitlementStatus",
  s."trial_ends_at",
  NULL,
  0, 0, 0, 0,
  COALESCE(s."trial_started_at", s."created_at"),
  COALESCE(s."trial_started_at", s."created_at"),
  0,
  s."created_at",
  s."updated_at"
FROM "subscriptions" s
WHERE NOT EXISTS (SELECT 1 FROM "entitlements" e WHERE e."user_id" = s."user_id");

-- RENAME, not DROP — ruling: do not destroy subscriptions until production
-- has been verified against it. The real DROP TABLE is its own separate,
-- deliberately UNAPPLIED migration (see
-- prisma/migrations/*_drop_subscriptions_legacy/migration.sql) that waits
-- for explicit approval after that verification. Renaming here still frees
-- the "subscriptions" name for any future use and makes it obvious at a
-- glance that this table is retired, without a single `migrate deploy`
-- being able to destroy the backfill's source data before anyone has
-- confirmed the backfill was correct.
--
-- The SubscriptionStatus enum type is NOT dropped here either — the
-- renamed table's "status" column still uses it. It is dropped in that
-- same later, unapplied migration, alongside the table itself.
ALTER TABLE "subscriptions" RENAME TO "subscriptions_legacy_20260914";
