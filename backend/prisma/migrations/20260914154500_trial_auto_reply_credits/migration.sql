-- Trial gets a taste of auto-reply: 0 -> 25 credits per cycle.
--
-- WHY: at 0 the trial was classification-only. It sorted the inbox and then
-- refused to answer anything, so the three days demonstrated the half of the
-- product nobody is buying. 25 is enough to see real replies go out and still
-- run out well before it substitutes for a plan.
--
-- Abuse is bounded by trialConsumedAt on the Instagram IDENTITY ledger, not by
-- this number — a second account or a fresh email does not earn a second
-- trial — which is what makes raising it safe.
--
-- PAIRED WITH CODE. src/lib/igIdentity.js TRIAL_AUTO_REPLY_CREDITS is the
-- value the grant transaction actually writes onto a new entitlement; this row
-- is what the catalogue advertises and what bank-cap arithmetic reads. They
-- must match. This migration exists as a separate step rather than an edit to
-- 20260914055207_seed_billing_catalogue because that migration is already
-- applied everywhere: editing it would change its checksum and put every
-- database into drift.
--
-- bank_cap moves with it. The rule is that the bank holds at most one cycle's
-- allowance, so a 25-credit cycle caps at 25. Leaving it at 0 would let
-- rollCycle zero out a trial's unspent credits the moment a cycle turned.
--
-- IDEMPOTENT and safe to re-run. Targets the TRIAL row only; no other plan,
-- and no existing entitlement, is touched — tenants already mid-trial keep the
-- balance they were granted, which may be 0. That is intentional: this is a
-- catalogue change, not a retroactive top-up.
--
-- REVERSE MIGRATION (manual):
--   UPDATE "billing_plans"
--   SET "auto_reply_credits_per_cycle" = 0, "auto_reply_bank_cap" = 0
--   WHERE "code" = 'TRIAL';
--   ...and set TRIAL_AUTO_REPLY_CREDITS back to 0 in the same deploy.

UPDATE "billing_plans"
SET "auto_reply_credits_per_cycle" = 25,
    "auto_reply_bank_cap"          = 25,
    "updated_at"                   = now()
WHERE "code" = 'TRIAL';
