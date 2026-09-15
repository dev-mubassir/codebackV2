-- Purely additive: 7 new tables, 3 new enums, no ALTER of any existing
-- table/column. Nothing in this migration can fail against existing data,
-- and nothing outside `entitlements`/`credit_ledger`/`orders`/`billing_plans`/
-- `plan_prices`/`addon_packs`/`addon_pack_prices`/`extra_ig_account_prices`
-- is touched. See schema.prisma for why `billing_plans` is not named `plans`.
--
-- REVERSE MIGRATION (not auto-applied — run manually if this needs undoing
-- before a further migration builds on it):
--
--   DROP TABLE IF EXISTS "addon_pack_prices" CASCADE;
--   DROP TABLE IF EXISTS "addon_packs" CASCADE;
--   DROP TABLE IF EXISTS "extra_ig_account_prices" CASCADE;
--   DROP TABLE IF EXISTS "plan_prices" CASCADE;
--   DROP TABLE IF EXISTS "billing_plans" CASCADE;
--   DROP TABLE IF EXISTS "orders" CASCADE;
--   DROP TABLE IF EXISTS "credit_ledger" CASCADE;
--   DROP TABLE IF EXISTS "entitlements" CASCADE;
--   DROP TYPE IF EXISTS "OrderStatus";
--   DROP TYPE IF EXISTS "CreditLedgerType";
--   DROP TYPE IF EXISTS "EntitlementStatus";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260914053953_add_billing_schema';

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('TRIALING', 'ACTIVE', 'GRACE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CreditLedgerType" AS ENUM ('GRANT', 'SPEND', 'EXPIRE', 'ROLLOVER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'PAID', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "billing_region" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'TRIALING',
    "valid_until" TIMESTAMP(3),
    "grace_until" TIMESTAMP(3),
    "reply_credits_current" INTEGER NOT NULL DEFAULT 0,
    "reply_credits_banked" INTEGER NOT NULL DEFAULT 0,
    "classification_count_cycle" INTEGER NOT NULL DEFAULT 0,
    "classification_count_hour" INTEGER NOT NULL DEFAULT 0,
    "hour_window_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cycle_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extra_ig_accounts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "type" "CreditLedgerType" NOT NULL,
    "source" TEXT NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "cashfree_order_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_code" TEXT,
    "addon_code" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "payment_country" TEXT,
    "raw_payload" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ig_account_limit" INTEGER,
    "auto_reply_credits_per_cycle" INTEGER,
    "auto_reply_bank_cap" INTEGER,
    "classification_cap_cycle" INTEGER,
    "classification_throttle_per_hour" INTEGER,
    "cycle_length_days" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "billing_region" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_packs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "credit_amount" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "addon_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_pack_prices" (
    "id" TEXT NOT NULL,
    "addon_pack_id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "billing_region" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "addon_pack_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extra_ig_account_prices" (
    "id" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "billing_region" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "extra_ig_account_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entitlements_user_id_key" ON "entitlements"("user_id");

-- CreateIndex
CREATE INDEX "entitlements_status_valid_until_idx" ON "entitlements"("status", "valid_until");

-- CreateIndex
CREATE INDEX "entitlements_status_grace_until_idx" ON "entitlements"("status", "grace_until");

-- CreateIndex
CREATE INDEX "credit_ledger_tenant_id_created_at_idx" ON "credit_ledger"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_cashfree_order_id_key" ON "orders"("cashfree_order_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_created_at_idx" ON "orders"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_code_key" ON "billing_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_plan_id_billing_region_key" ON "plan_prices"("plan_id", "billing_region");

-- CreateIndex
CREATE UNIQUE INDEX "addon_packs_code_key" ON "addon_packs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "addon_pack_prices_addon_pack_id_plan_code_billing_region_key" ON "addon_pack_prices"("addon_pack_id", "plan_code", "billing_region");

-- CreateIndex
CREATE UNIQUE INDEX "extra_ig_account_prices_plan_code_billing_region_key" ON "extra_ig_account_prices"("plan_code", "billing_region");

-- AddForeignKey
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_pack_prices" ADD CONSTRAINT "addon_pack_prices_addon_pack_id_fkey" FOREIGN KEY ("addon_pack_id") REFERENCES "addon_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

