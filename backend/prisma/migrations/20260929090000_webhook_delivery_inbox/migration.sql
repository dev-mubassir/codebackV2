-- Additive only: nullable columns plus one defaulted counter and an index.
--
-- webhook_deliveries becomes a durable inbox. The raw signed Meta payload is
-- stored BEFORE the 200, processed from the database (queue or recovery
-- sweep), then cleared. A crash, redeploy, Redis outage or AI outage can
-- therefore never lose a DM that Meta was told we received.
--
-- Existing rows keep payload = NULL and are never re-processed. Old code does
-- not read these columns, so rolling back the app is safe.
ALTER TABLE "webhook_deliveries" ADD COLUMN "payload" TEXT;
ALTER TABLE "webhook_deliveries" ADD COLUMN "processed_at" TIMESTAMP(3);
ALTER TABLE "webhook_deliveries" ADD COLUMN "claimed_at" TIMESTAMP(3);
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "webhook_deliveries" ADD COLUMN "last_error" TEXT;

CREATE INDEX "webhook_deliveries_processed_at_received_at_idx" ON "webhook_deliveries"("processed_at", "received_at");
