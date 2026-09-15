-- Why an inbound message was not classified, and when a skipped one was recovered.
--
-- WHY: with billing on, messageAnalysisJob marks a DM `skipped` whenever the
-- classification gate is not 'ok', and recorded nothing else. A skip for
-- `not_entitled` (clears when a trial or plan is granted), `cycle_cap` (clears
-- at the cycle roll) and `hourly_throttle` (gave up after its re-queues) were
-- indistinguishable, so nothing could recover the right ones and the inbox
-- could not say why a DM went unsorted.
--
--   ai_skip_reason   the gate reason at the moment of the skip; NULL for any
--                    other status, and for skips recorded before this column
--   ai_recovered_at  set when services/skippedMessageRecovery re-queues a
--                    skipped message after an entitlement grant. Durable on
--                    purpose: messageAnalysisJob allows a recovered message to
--                    auto-reply only if it arrived within the last hour, and
--                    that rule must survive the stalled-analysis sweeper
--                    re-queueing the message without its original job data.
--
-- Additive, nullable, no backfill: a pre-existing skip has no knowable reason.
-- REVERSE (manual):
--   ALTER TABLE "messages" DROP COLUMN "ai_recovered_at";
--   ALTER TABLE "messages" DROP COLUMN "ai_skip_reason";

ALTER TABLE "messages" ADD COLUMN "ai_skip_reason" TEXT;
ALTER TABLE "messages" ADD COLUMN "ai_recovered_at" TIMESTAMP(3);
