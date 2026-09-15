-- Refunds, and what each grant changed (Gates 11b, 11c).
--
--   refunds                one row per refund. Admin-initiated through
--                          /api/admin/billing/..., or recorded from a
--                          REFUND_STATUS_WEBHOOK for a refund issued outside
--                          Siffty. Partial refunds are rows whose amount is less
--                          than the order's. status only ever comes from Cashfree
--                          (create response, webhook, or a re-sync), so a refund
--                          that fails at Cashfree can never look successful here.
--   orders.grant_snapshot  what the fulfilment grant replaced and added, written
--                          in the fulfilment transaction. Revocation needs the
--                          pre-order validUntil, which cannot be reconstructed.
--   credit_ledger.note     free-text detail for a row; a refund revocation records
--                          the credits granted, removed, and any shortfall here.
--
-- Additive: new table, new enum, two nullable columns. No backfill — orders paid
-- before this have no snapshot, and revocation falls back to a best estimate
-- with a CRITICAL alert (lib/billingAlerts.js, refundSnapshotMissing).
-- REVERSE (manual):
--   DROP TABLE "refunds"; DROP TYPE "RefundStatus";
--   ALTER TABLE "orders" DROP COLUMN "grant_snapshot";
--   ALTER TABLE "credit_ledger" DROP COLUMN "note";

CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PENDING', 'ONHOLD', 'SUCCESS', 'CANCELLED', 'FAILED');

ALTER TABLE "orders" ADD COLUMN "grant_snapshot" JSONB;
ALTER TABLE "credit_ledger" ADD COLUMN "note" TEXT;

CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "refund_id" TEXT NOT NULL,
    "cashfree_order_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "cf_refund_id" TEXT,
    "arn" TEXT,
    "status_description" TEXT,
    "initiated_by" TEXT NOT NULL,
    "override_policy" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "policy_check" JSONB,
    "revoked_at" TIMESTAMP(3),
    "revocation" JSONB,
    "last_error" TEXT,
    "raw_payload" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refunds_refund_id_key" ON "refunds"("refund_id");
CREATE INDEX "refunds_cashfree_order_id_idx" ON "refunds"("cashfree_order_id");
CREATE INDEX "refunds_tenant_id_created_at_idx" ON "refunds"("tenant_id", "created_at");
CREATE INDEX "refunds_status_idx" ON "refunds"("status");
