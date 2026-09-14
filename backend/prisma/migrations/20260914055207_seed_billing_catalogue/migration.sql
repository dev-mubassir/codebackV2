-- Seed data, not schema — but the entitlement service (Gate 2) fails loud
-- rather than silently substituting when a plan code is missing (same
-- precedent as the old billingService.getEffectivePlanLimits), and the
-- trial's own classification cap/throttle (100/cycle, 100/hr) need a Plan
-- row to be enforced at all. Seeding real catalogue numbers here is not the
-- same thing the brief's "no hardcoded prices" rule forbids — that rule is
-- about the APPLICATION never assuming a price at runtime; every price here
-- lives in a row the application reads, and can be changed with a plain
-- UPDATE, no redeploy, exactly as required. Numbers are taken verbatim from
-- the feat/billing brief.
--
-- Enterprise gets a Plan row (so a tenant can be assigned it) but every cap
-- and every price is left NULL/absent — "Custom" per the brief, and the
-- Enterprise self-serve flow is explicitly out of scope, so nothing here
-- enforces a number for it. An admin sets it manually; there is no UI for
-- that yet.
--
-- REVERSE MIGRATION (manual): DELETE FROM these six tables WHERE the rows
-- inserted here (all of them, on a fresh apply) — safe to just TRUNCATE
-- addon_pack_prices, addon_packs, extra_ig_account_prices, plan_prices,
-- billing_plans in that order (FK-dependency order) if this needs undoing.

INSERT INTO "billing_plans"
  ("id", "code", "name", "ig_account_limit", "auto_reply_credits_per_cycle", "auto_reply_bank_cap", "classification_cap_cycle", "classification_throttle_per_hour", "cycle_length_days", "is_active", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'TRIAL',      'Trial',      1,    0,    0,    100,   100,  3,  true, now(), now()),
  (gen_random_uuid()::text, 'STARTER',    'Starter',    1,    500,  500,  10000, 500,  30, true, now(), now()),
  (gen_random_uuid()::text, 'PRO',        'Pro',        2,    2000, 2000, 50000, 2000, 30, true, now(), now()),
  (gen_random_uuid()::text, 'ENTERPRISE', 'Enterprise', NULL, NULL, NULL, NULL,  NULL, 30, true, now(), now());

-- Plan prices. Amounts are the smallest currency unit — paise for INR,
-- cents for USD. No row for TRIAL (free) or ENTERPRISE (contact us).
INSERT INTO "plan_prices" ("id", "plan_id", "billing_region", "currency", "amount")
SELECT gen_random_uuid()::text, p."id", v."billing_region", v."currency", v."amount"
FROM "billing_plans" p
JOIN (VALUES
  ('STARTER', 'IN',   'INR', 49900),
  ('STARTER', 'INTL', 'USD', 1900),
  ('PRO',     'IN',   'INR', 129900),
  ('PRO',     'INTL', 'USD', 4900)
) AS v("code", "billing_region", "currency", "amount") ON v."code" = p."code";

-- Consumable add-on: +500 auto-replies. One pack, priced per purchasing
-- plan tier (cheaper on Pro, on purpose — see AddonPackPrice's schema note).
INSERT INTO "addon_packs" ("id", "code", "credit_amount", "is_active")
VALUES (gen_random_uuid()::text, 'reply_credits_500', 500, true);

INSERT INTO "addon_pack_prices" ("id", "addon_pack_id", "plan_code", "billing_region", "currency", "amount")
SELECT gen_random_uuid()::text, ap."id", v."plan_code", v."billing_region", v."currency", v."amount"
FROM "addon_packs" ap
JOIN (VALUES
  ('STARTER', 'IN',   'INR', 24900),
  ('STARTER', 'INTL', 'USD', 900),
  ('PRO',     'IN',   'INR', 14900),
  ('PRO',     'INTL', 'USD', 500)
) AS v("plan_code", "billing_region", "currency", "amount") ON ap."code" = 'reply_credits_500';

-- Recurring add-on: +1 IG account. No pack concept — priced directly per
-- purchasing plan tier and region.
INSERT INTO "extra_ig_account_prices" ("id", "plan_code", "billing_region", "currency", "amount")
VALUES
  (gen_random_uuid()::text, 'STARTER', 'IN',   'INR', 29900),
  (gen_random_uuid()::text, 'STARTER', 'INTL', 'USD', 1200),
  (gen_random_uuid()::text, 'PRO',     'IN',   'INR', 19900),
  (gen_random_uuid()::text, 'PRO',     'INTL', 'USD', 700);
