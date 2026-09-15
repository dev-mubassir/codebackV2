-- Let a customer turn off the optional renewal reminder emails (Gate 11a).
--
-- WHY: there is no auto-debit, so there is no subscription to cancel — not
-- renewing IS cancelling. The one thing a customer could actually want to stop
-- is being reminded. This column switches off the two early nudges (DAY_27,
-- DAY_29) only. The expiry-day and grace-final notices are service notices —
-- auto-replies stop, credits are about to be cleared — and keep sending; the
-- settings page says so next to the switch.
--
--   renewal_nudge_emails   true (default) sends the nudges; false skips them.
--                          Read by jobs/renewalReminderJob.js.
--
-- Additive, NOT NULL with a default, so every existing user keeps today's
-- behaviour and no backfill is needed.
-- REVERSE (manual):
--   ALTER TABLE "users" DROP COLUMN "renewal_nudge_emails";

ALTER TABLE "users" ADD COLUMN "renewal_nudge_emails" BOOLEAN NOT NULL DEFAULT true;
