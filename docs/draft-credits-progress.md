# Draft credits — progress log

Branch: `draft-credits` (from master `cd3d133`). Autonomous run; one owner stop in Phase 5.

## RESUME HERE

Phases 0–4 DONE. Phase 5 step 1 DONE: master fast-forwarded locally to the draft-credits commits (NOT pushed).
WAITING FOR THE OWNER: DB backup + `backend/scripts/prod-migrate.ps1`. The only new migration is
`20260927090000_draft_credits` (additive; see its header). After the owner says "migrated" with the status
output: verify it lists that migration as applied, push master, then Phase 6 (poll api.siffty.com/health,
read-only Northflank logs, landing page check, public /api/billing/plans if billing is on).

Local dev DB already has the migration applied (backup of the pre-migration dev DB was taken to the session
scratchpad). Local tunnel/dev servers were stopped after testing.

## Phase 0 — state check (done)

- Working tree clean; master == origin/master == `cd3d133` (legacy-admin cleanup migration committed and pushed).
- Created branch `draft-credits`.

## Phase 1 — audit findings

**Draft button today.** `POST /api/conversations/:id/generate-reply` (backend/src/routes/api.js) calls
`aiService.generateReply` and writes a `ReplyGeneration` row. It consumes NOTHING: no entitlement check and no
ledger row, whether billing is on or off.

**Reply credits end to end.**
- Catalogue: `billing_plans.auto_reply_credits_per_cycle` / `auto_reply_bank_cap` (TRIAL 25/25, STARTER 500/500,
  PRO 2000/2000, ENTERPRISE null). Prices in `plan_prices`.
- Terms snapshot (Gate 6): `entitlements.term_*` + `terms_snapshot_at`, copied at every grant (`termsFrom`).
  Credits per cycle are NOT snapshotted; grantPlan reads the live plan at grant time.
- Balances: `entitlements.reply_credits_current` + `reply_credits_banked`, FIFO spend (banked first).
- Ledger: `credit_ledger` append-only, one `balance_after` per row. Invariant "ledger sum == held balance"
  (tests/ledger-invariant.test.js, scripts/billing-doctor.js).
- Cycle: `grantPlan` (purchase/renewal/admin grant) carries min(balance, max(old cap, new cap)) into the bank and
  grants the new cycle, EXPIRE rows for anything discarded. `rollCycle` (entitlementCycleJob, no renewal) banks
  current into the bank capped at the bank cap. Cold start forfeits.
- Trial: `igIdentity.grantTrialInTx` writes the TRIAL plan's credits directly.
- Add-ons: `addon_packs` (+ `addon_pack_prices` per purchasing tier STARTER/PRO and region), one pack
  `reply_credits_500` (STARTER ₹299/$12, PRO ₹149/$5). Checkout `POST /api/billing/checkout/addon` needs an active
  STARTER/PRO plan with a locked region. Cashfree webhook -> `billingFulfillment.fulfillPaidOrder` ->
  `grantAddon`; reconciliation job heals through the same function. Order `grant_snapshot` records
  grantedCredits / creditsAheadAtGrant.
- Refunds: `refundService` (admin only) -> `revokeOrderGrant` removes what is left of the purchase's own credits
  (FIFO, `creditsUsedFromOrder`). Policy: top-up refundable only if entirely unused.
- Admin: plan editor (`/api/admin/plans`, step-up + reason + audit). NO add-on pack editor exists yet.
  Per-customer: grant-plan / extend / bonus-quota (classifications only) / reset-trial. Payments list, metrics.
- Customer: `GET /api/billing/summary` (credits card, add-on shelf), public `GET /api/billing/plans`.
- Landing page (`frontend/src/app/page.js` section 8) has HARDCODED prices (₹499 / ₹1,299 / from ₹4,999) that
  match the seed; `PricingSection.js` exists but is not mounted. Refund policy mentions auto-reply credits
  and top-ups.
- Gate: `isBillingEnabled()` = admin setting `enforce_subscriptions` (default BILLING_ENABLED env).

## Decisions

- **1/4 rule.** `billing_plans.draft_credits_per_cycle` = floor(reply credits / 4): TRIAL 6, STARTER 125, PRO 500,
  ENTERPRISE null (= unlimited). `draft_bank_cap` = floor(reply bank cap / 4): 6 / 125 / 500 / null.
- **Packs.** Two draft packs, sizes matched to the 500-reply pack: `draft_credits_125` (a quarter of it, same
  1/4 ratio) and `draft_credits_500` (the same count). Same per-credit price as `reply_credits_500`
  (STARTER 59.8 paise / 2.4¢, PRO 29.8 paise / 1¢):
  - draft_credits_125: STARTER ₹74.75 / $3.00, PRO ₹37.25 / $1.25
  - draft_credits_500: STARTER ₹299 / $12, PRO ₹149 / $5
- **Cycle rules = reply rules.** Same code paths, a second pool: grantPlan grants the plan's draft credits and
  carries the draft balance into the draft bank (capped at max(old, new) draft bank cap); rollCycle banks with the
  draft bank cap; cold start forfeits; EXPIRE rows for every discard. Unlimited plans hold no draft balance.
- **Ledger.** Same `credit_ledger` table, new column `pool` (REPLY default | DRAFT); `balance_after` is the balance
  of that row's pool. New nullable `idempotency_key` with unique (tenant_id, idempotency_key) for draft spends.
  Draft sources are prefixed `draft:` so no existing source-based query matches them.
- **Terms.** `entitlements.term_draft_credits_per_cycle`, `term_draft_bank_cap`, and a separate
  `draft_terms_at` marker (NOT terms_snapshot_at — old code writes that during the deploy window without the draft
  terms, which would read as "unlimited").
- **Old-code safety for packs.** New column `addon_packs.is_listed` (backfilled from is_active) is what the new
  code reads. Draft packs are inserted with `is_active = false`, so the pre-draft code (which reads is_active) can
  never list or sell them as reply credits during the deploy window or after a rollback.
- **Draft spend.** Reserve 1 credit (row lock, FIFO) before the AI call, refund it with a compensating GRANT row if
  the call fails or anything after it throws. Client sends a per-click `Idempotency-Key`; the spend row and the
  ReplyGeneration row carry it (unique), so a double-click/retry returns the same draft and charges once.
  Enterprise (unlimited): no ledger row. Auto-reply keeps `spendReplyCredit` — pools never mix.
- **Billing ON vs OFF.** OFF: draft route behaves exactly as today (no gate, no ledger, no counter; the
  `/api/billing/*` counter endpoint 404s). ON: only TRIALING/ACTIVE may draft (same as auto-reply; GRACE/EXPIRED/NONE
  get 402 DRAFT_NOT_ENTITLED), 0 credits -> 402 DRAFT_CREDITS_EXHAUSTED, each successful draft costs 1.
- **Backfill.** Every entitlement with a plan gets draft terms from its plan. Live ones (valid_until in the future,
  TRIALING/ACTIVE/GRACE) get one cycle's draft allowance as balance, with a matching `draft:backfill` GRANT row so
  the invariant holds. NOTE: the OLD billing:doctor sums all pools and would report drift for those tenants until
  the new code is deployed — it is a manual script, not a runtime path.

## Phase log

- **Phase 2 (backend)** — schema + migration `20260927090000_draft_credits`; entitlementService draft pool
  (terms, reserve/refund with row lock + idempotency key, grantPlan/grantAddon/rollCycle/revoke per pool,
  creditsUsedFromOrder per pool); trial grant; fulfilment snapshot (pool, grantedDraftCredits,
  draftCreditsAheadAtGrant); refund policy kind `draft_pack`; draft route gate; `/api/billing/plans`
  (`addons.draftCredits`, draft terms), `/summary` (`draftCredits`, draft packs excluded from the Pro verdict),
  `GET /api/billing/draft-credits`; admin: plan draft fields (1/4 default on create), add-on pack editor
  (`/api/admin/addon-packs`, step-up + reason + audit), customer detail draft balance, bonus-quota
  `draftCredits`, payments `itemKind`, metrics `draftsPerDay`; billing:doctor invariant per pool.
- **Phase 3 (frontend)** — inbox counter / disabled button + "Buy draft credits" link (no counter with billing
  off); billing page draft balance + draft packs; PlanCard draft line; landing: draft lines per plan + add-ons
  table (all four add-ons, INR); refund policy + new Terms §6 "Plans, credits and payments"; admin Plans,
  new Add-on packs page, customer detail, payments label, metrics.
- **Phase 4 (tests)** — backend 715 passed / 12 skipped (baseline 690); new: tests/draft-credits.test.js (23),
  tests/landing-pricing-seed.test.js (2, negative control verified). Existing ledger tests now check both
  pools. Frontend lint 0 errors (pre-existing img warnings only); `next build` OK.
  Local E2E via the running API: 16/16 — including a REAL Cashfree SANDBOX checkout of draft_credits_125
  (₹74.75, test UPI) fulfilled by the real PAYMENT_SUCCESS_WEBHOOK through the dev tunnel. Throwaway tenant
  deleted (0 rows left). Landing checked at 375px: no horizontal overflow.
  Not visually checked: inbox/billing/admin pages (would need a password typed into a login form).
