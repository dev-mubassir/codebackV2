-- Gate 3.1 corrections (schema part). Purely additive except the two
-- AlterTable ADD COLUMN statements, which add nullable columns to existing
-- rows (default NULL, no backfill needed — every existing Order/Entitlement
-- row predates the regionSource concept and is correctly "we don't know").
--
-- DELIBERATELY DOES NOT include a DROP TABLE/DROP TYPE for
-- "subscriptions_legacy_20260914"/"SubscriptionStatus", even though this
-- schema no longer has a Prisma model for either — Prisma's own diff
-- proposed dropping both here (it has no way to know the table is being
-- deliberately preserved), and that is exactly the premature destruction
-- 3.1.5 exists to prevent. The real drop is its own separate, deliberately
-- UNAPPLIED migration — see *_drop_subscriptions_legacy/migration.sql.
--
-- user_sessions is NOT in this file — see the separate
-- *_adopt_user_sessions migration. Bundling it here would have made this
-- entire migration fail with "relation already exists" on local dev and
-- production, where connect-pg-simple already created that table at
-- runtime, even though everything else in this file is a normal, safe
-- apply everywhere.

-- CreateEnum
CREATE TYPE "RegionSource" AS ENUM ('RAIL_INFERRED', 'CARD_COUNTRY', 'UNVERIFIED');

-- AlterEnum
ALTER TYPE "CreditLedgerType" ADD VALUE 'CLASSIFY';

-- AlterTable
ALTER TABLE "credit_ledger" ADD COLUMN     "message_id" TEXT;

-- AlterTable
ALTER TABLE "entitlements" ADD COLUMN     "region_source" "RegionSource";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "region_source" "RegionSource";

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_tenant_id_message_id_type_key" ON "credit_ledger"("tenant_id", "message_id", "type");
