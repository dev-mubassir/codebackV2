-- Pricing rulings 3a and 3d. Data only — no schema change in this file
-- beyond the isQuoteOnly column, which the catalogue needs to distinguish a
-- contact-us tier from a purchasable one.
--
-- 3a. STARTER's +500 reply-credit top-up goes ₹249 -> ₹299 and $9 -> $12.
--     Pro's stays at ₹149/$5, and the extra-IG-account prices are already
--     correct, so only two rows move.
--
--     WHY. At ₹249 the upgrade pitch was arithmetically false: three Starter
--     packs bought the same 2,000 replies as Pro for ₹1,246 against Pro's
--     ₹1,299 — Starter was CHEAPER at identical entitlements, so there was
--     no saving to show and the banner correctly rendered nothing.
--     At ₹299 the break-even lands at three packs: 499 + 3x299 = ₹1,396 for
--     the same 2,000 replies, so Pro is ₹97 cheaper AND carries the second
--     Instagram account. USD moves in step: 19 + 3x12 = $55 against $49.
--
-- 3d. ENTERPRISE gets real prices (₹4,999 / $149) plus isQuoteOnly, so the
--     marketing card can render "From ₹4,999/mo · Contact us" from the
--     catalogue instead of hardcoding a number in a component — the rule
--     every other price already follows.

-- AlterTable: a plan that is quoted, not checked out.
ALTER TABLE "billing_plans" ADD COLUMN "is_quote_only" BOOLEAN NOT NULL DEFAULT false;

-- 3a — reprice the Starter top-up.
UPDATE "addon_pack_prices" ap
SET "amount" = CASE ap."billing_region" WHEN 'IN' THEN 29900 ELSE 1200 END
FROM "addon_packs" a
WHERE ap."addon_pack_id" = a."id"
  AND a."code" = 'reply_credits_500'
  AND ap."plan_code" = 'STARTER';

-- 3d — Enterprise is quote-only...
UPDATE "billing_plans" SET "is_quote_only" = true WHERE "code" = 'ENTERPRISE';

-- ...and carries a "from" price so the card renders from data. Guarded by
-- NOT EXISTS so re-running cannot duplicate a row (plan_prices is unique on
-- (plan_id, billing_region), but failing loudly on a re-run would be worse
-- than doing nothing).
INSERT INTO "plan_prices" ("id", "plan_id", "billing_region", "currency", "amount")
SELECT gen_random_uuid()::text, p."id", v."billing_region", v."currency", v."amount"
FROM "billing_plans" p
JOIN (VALUES
  ('IN',   'INR', 499900),
  ('INTL', 'USD', 14900)
) AS v("billing_region", "currency", "amount") ON TRUE
WHERE p."code" = 'ENTERPRISE'
  AND NOT EXISTS (
    SELECT 1 FROM "plan_prices" pp
    WHERE pp."plan_id" = p."id" AND pp."billing_region" = v."billing_region"
  );
