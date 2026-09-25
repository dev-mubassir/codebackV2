-- Draft credits: a second credit pool for the manual "Draft AI reply" button.
--
-- ADDITIVE ONLY, and safe while the previous release is still running:
--   * every new column is nullable or has a default, so the old code's inserts
--     and updates keep working unchanged;
--   * credit_ledger.pool defaults to REPLY, so every row the old code writes is
--     a reply-pool row, which is what it is;
--   * the draft packs are inserted with is_active = false. The old code lists
--     and sells packs by is_active, so it can never offer a draft pack as reply
--     credits — not during the deploy window, and not after a rollback. The new
--     code reads is_listed instead (backfilled from is_active for the existing
--     reply pack).
--   * no existing row is changed except by adding values to the new columns.
--
-- THE 1/4 RULE: draft credits per cycle = floor(auto-reply credits / 4), and the
-- draft bank cap = floor(auto-reply bank cap / 4). ENTERPRISE stays NULL =
-- unlimited. Only plans whose draft columns are still NULL are set, so a
-- re-run never overwrites an admin's edit.
--
-- PACK PRICES: the same per-credit price as reply_credits_500, per tier and
-- region (STARTER 59.8 paise / 2.4 cents, PRO 29.8 paise / 1 cent):
--   draft_credits_125  STARTER 7475 paise / 300 cents   PRO 3725 paise / 125 cents
--   draft_credits_500  STARTER 29900 paise / 1200 cents PRO 14900 paise / 500 cents
--
-- BACKFILL: every entitlement with a plan gets that plan's draft terms. Live
-- ones (valid_until still in the future) also get one cycle's draft allowance
-- as balance, recorded as a draft:backfill GRANT row so "ledger sum == held
-- balance" holds per pool.
--
-- REVERSE (manual):
--   DELETE FROM credit_ledger WHERE pool = 'DRAFT';
--   DELETE FROM addon_packs WHERE pool = 'DRAFT';   -- cascades to addon_pack_prices
--   DROP INDEX "credit_ledger_tenant_id_idempotency_key_key";
--   DROP INDEX "reply_generations_user_id_idempotency_key_key";
--   ALTER TABLE reply_generations DROP COLUMN idempotency_key;
--   ALTER TABLE entitlements DROP COLUMN draft_credits_current, DROP COLUMN draft_credits_banked,
--     DROP COLUMN term_draft_credits_per_cycle, DROP COLUMN term_draft_bank_cap, DROP COLUMN draft_terms_at;
--   ALTER TABLE credit_ledger DROP COLUMN pool, DROP COLUMN idempotency_key;
--   ALTER TABLE addon_packs DROP COLUMN pool, DROP COLUMN is_listed;
--   ALTER TABLE billing_plans DROP COLUMN draft_credits_per_cycle, DROP COLUMN draft_bank_cap;
--   DROP TYPE "CreditPool";

-- CreateEnum
CREATE TYPE "CreditPool" AS ENUM ('REPLY', 'DRAFT');

-- AlterTable
ALTER TABLE "billing_plans" ADD COLUMN "draft_credits_per_cycle" INTEGER,
ADD COLUMN "draft_bank_cap" INTEGER;

-- AlterTable
ALTER TABLE "entitlements" ADD COLUMN "draft_credits_current" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "draft_credits_banked" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "term_draft_credits_per_cycle" INTEGER,
ADD COLUMN "term_draft_bank_cap" INTEGER,
ADD COLUMN "draft_terms_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "credit_ledger" ADD COLUMN "pool" "CreditPool" NOT NULL DEFAULT 'REPLY',
ADD COLUMN "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "addon_packs" ADD COLUMN "is_listed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pool" "CreditPool" NOT NULL DEFAULT 'REPLY';

-- AlterTable
ALTER TABLE "reply_generations" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex (all existing rows have NULL keys; Postgres never treats NULLs as equal)
CREATE UNIQUE INDEX "credit_ledger_tenant_id_idempotency_key_key" ON "credit_ledger"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "reply_generations_user_id_idempotency_key_key" ON "reply_generations"("user_id", "idempotency_key");

-- The 1/4 rule on the catalogue.
UPDATE "billing_plans"
SET "draft_credits_per_cycle" = "auto_reply_credits_per_cycle" / 4,
    "draft_bank_cap"          = "auto_reply_bank_cap" / 4
WHERE "draft_credits_per_cycle" IS NULL
  AND "draft_bank_cap" IS NULL
  AND "auto_reply_credits_per_cycle" IS NOT NULL;

-- Existing reply packs keep their visibility under the new column.
UPDATE "addon_packs" SET "is_listed" = "is_active" WHERE "pool" = 'REPLY';

-- Draft packs: listed for the new code, inactive for the old code.
INSERT INTO "addon_packs" ("id", "code", "credit_amount", "is_active", "is_listed", "pool")
SELECT gen_random_uuid()::text, v."code", v."credit_amount", false, true, 'DRAFT'::"CreditPool"
FROM (VALUES ('draft_credits_125', 125), ('draft_credits_500', 500)) AS v("code", "credit_amount")
WHERE NOT EXISTS (SELECT 1 FROM "addon_packs" a WHERE a."code" = v."code");

INSERT INTO "addon_pack_prices" ("id", "addon_pack_id", "plan_code", "billing_region", "currency", "amount")
SELECT gen_random_uuid()::text, ap."id", v."plan_code", v."billing_region", v."currency", v."amount"
FROM "addon_packs" ap
JOIN (VALUES
  ('draft_credits_125', 'STARTER', 'IN',   'INR', 7475),
  ('draft_credits_125', 'STARTER', 'INTL', 'USD', 300),
  ('draft_credits_125', 'PRO',     'IN',   'INR', 3725),
  ('draft_credits_125', 'PRO',     'INTL', 'USD', 125),
  ('draft_credits_500', 'STARTER', 'IN',   'INR', 29900),
  ('draft_credits_500', 'STARTER', 'INTL', 'USD', 1200),
  ('draft_credits_500', 'PRO',     'IN',   'INR', 14900),
  ('draft_credits_500', 'PRO',     'INTL', 'USD', 500)
) AS v("code", "plan_code", "billing_region", "currency", "amount") ON v."code" = ap."code"
WHERE NOT EXISTS (
  SELECT 1 FROM "addon_pack_prices" pp
  WHERE pp."addon_pack_id" = ap."id" AND pp."plan_code" = v."plan_code" AND pp."billing_region" = v."billing_region"
);

-- Backfill: draft terms for every entitlement on a plan.
UPDATE "entitlements" e
SET "term_draft_credits_per_cycle" = p."draft_credits_per_cycle",
    "term_draft_bank_cap"          = p."draft_bank_cap",
    "draft_terms_at"               = CURRENT_TIMESTAMP
FROM "billing_plans" p
WHERE p."code" = e."plan_code"
  AND e."draft_terms_at" IS NULL;

-- Backfill: one cycle's draft allowance for live entitlements, with its ledger row.
WITH granted AS (
  UPDATE "entitlements" e
  SET "draft_credits_current" = e."term_draft_credits_per_cycle"
  WHERE e."term_draft_credits_per_cycle" IS NOT NULL
    AND e."term_draft_credits_per_cycle" > 0
    AND e."valid_until" > CURRENT_TIMESTAMP
    AND e."status" IN ('TRIALING', 'ACTIVE', 'GRACE')
    AND e."draft_credits_current" = 0
    AND e."draft_credits_banked" = 0
  RETURNING e."user_id", e."draft_credits_current"
)
INSERT INTO "credit_ledger" ("id", "tenant_id", "delta", "type", "pool", "source", "balance_after", "note", "created_at")
SELECT gen_random_uuid()::text, g."user_id", g."draft_credits_current", 'GRANT', 'DRAFT', 'draft:backfill',
       g."draft_credits_current", 'draft credits introduced: one cycle''s allowance', CURRENT_TIMESTAMP
FROM granted g;
