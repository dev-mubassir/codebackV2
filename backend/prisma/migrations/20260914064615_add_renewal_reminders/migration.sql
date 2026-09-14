-- Idempotency guard for the renewal reminder sequence (Gate 7). Purely
-- additive: one new table, nothing existing is touched.
--
-- Timestamped 064615 deliberately — BEFORE
-- 20260914064620_drop_subscriptions_legacy. Migrations apply in name order,
-- so a later timestamp would have forced anyone reaching this migration to
-- apply the subscriptions drop first, which is exactly the one migration
-- that must stay unapplied until production has been verified.

-- CreateTable
CREATE TABLE "renewal_reminders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cycle_started_at" TIMESTAMP(3) NOT NULL,
    "reminder_type" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renewal_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "renewal_reminders_tenant_id_sent_at_idx" ON "renewal_reminders"("tenant_id", "sent_at");

-- CreateIndex: the guard itself — one reminder of each type per tenant per cycle.
CREATE UNIQUE INDEX "renewal_reminders_tenant_id_cycle_started_at_reminder_type_key" ON "renewal_reminders"("tenant_id", "cycle_started_at", "reminder_type");
