-- Order state is "has a successful payment or not"; attempts live on their own.
--
-- WHY: an order used to be marked FAILED when one payment ATTEMPT failed. But
-- Cashfree lets a customer retry on the same order, so FAILED never meant the
-- order was dead — it only meant one try had not worked. Mixing the two made a
-- failed-then-successful order look terminal. Now:
--
--   orders.status        CREATED (no successful payment yet) | PAID | EXPIRED.
--                        EXPIRED is the only terminal state, and it comes only
--                        from expiry: Cashfree reporting the order expired, or
--                        the reconciliation job's 7-day safety net.
--   payment_attempts     one row per attempt outcome Cashfree reported
--                        (SUCCESS, FAILED, USER_DROPPED, ...). Replays collide
--                        on (cashfree_order_id, cf_payment_id, status).
--
-- DATA: a FAILED order carrying a raw payload came from PAYMENT_FAILED_WEBHOOK,
-- so it becomes CREATED again (still payable until it expires) and its failure
-- is preserved as an attempt row. A FAILED order with no payload came from a
-- checkout whose Cashfree order was never created, so it becomes EXPIRED.
--
-- REVERSE (manual): recreate the enum with FAILED, then
--   UPDATE "orders" SET "status" = 'FAILED' WHERE ... (the original split is
--   recoverable from payment_attempts), and DROP TABLE "payment_attempts".

CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "cashfree_order_id" TEXT NOT NULL,
    "cf_payment_id" TEXT,
    "status" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payment_group" TEXT,
    "failure_reason" TEXT,
    "raw_payload" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_attempts_cashfree_order_id_cf_payment_id_status_key"
    ON "payment_attempts"("cashfree_order_id", "cf_payment_id", "status");

CREATE INDEX "payment_attempts_cashfree_order_id_created_at_idx"
    ON "payment_attempts"("cashfree_order_id", "created_at");

INSERT INTO "payment_attempts" ("id", "cashfree_order_id", "status", "event_type", "raw_payload", "created_at")
SELECT gen_random_uuid()::text, "cashfree_order_id", 'FAILED', 'PAYMENT_FAILED_WEBHOOK', "raw_payload", "created_at"
  FROM "orders"
 WHERE "status" = 'FAILED' AND "raw_payload" IS NOT NULL;

UPDATE "orders" SET "status" = 'CREATED' WHERE "status" = 'FAILED' AND "raw_payload" IS NOT NULL;
UPDATE "orders" SET "status" = 'EXPIRED' WHERE "status" = 'FAILED';

ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'PAID', 'EXPIRED');
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::text::"OrderStatus");
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'CREATED';
DROP TYPE "OrderStatus_old";
