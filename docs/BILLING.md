# Billing

How Siffty's billing works, and why it is built the way it is. The code carries
the detail; this carries the reasoning that will not be obvious from the code in
two months.

- [1. The model: purchases, not subscriptions](#1-the-model-purchases-not-subscriptions)
- [2. The three flags](#2-the-three-flags)
- [3. Entitlement lifecycle and what each state allows](#3-entitlement-lifecycle-and-what-each-state-allows)
- [4. Plan changes, and why downgrades are blocked](#4-plan-changes-and-why-downgrades-are-blocked)
- [5. Credits and the ledger invariant](#5-credits-and-the-ledger-invariant)
- [6. The trial](#6-the-trial)
- [7. Classification gating](#7-classification-gating)
- [8. First deploy](#8-first-deploy)
- [9. Local development: granting and resetting trials](#9-local-development-granting-and-resetting-trials)

Where the code lives:

| Concern | File |
|---|---|
| Quota, expiry, grants, spend, cycle roll | `backend/src/services/entitlementService.js` |
| Trial eligibility, grant, identity ledger | `backend/src/lib/igIdentity.js` |
| Billing HTTP routes (`/plans`, `/summary`, `/trial/claim`, checkout) | `backend/src/routes/billing.js` |
| Cashfree order creation | `backend/src/lib/cashfreeOrders.js` |
| "An order was paid" (webhook + nightly reconciliation) | `backend/src/services/billingFulfillment.js` |
| Flags | `backend/src/lib/billingFlags.js` |
| Which trial card a page shows | `frontend/src/lib/trialState.js` |

---

## 1. The model: purchases, not subscriptions

Every plan period and every add-on is a **one-time Cashfree order**. There is no
Subscriptions API, no mandate, no autopay, and no stored card anywhere in the
codebase.

- **Why: conversion over retention, deliberately.** Mandate registration is the
  single largest drop-off in Indian SaaS checkout. Removing it trades
  retention for conversion, and before launch that is the right trade: a
  customer who never gets through checkout never has the chance to renew.
- **What else it removes.** No Subscriptions API, no e-mandate approval flow, no
  pre-debit notification rules, and no mandate-maximum screen at checkout. It
  also avoids recurring mandates on foreign cards through an Indian
  aggregator. `cashfreeOrders.js` and the Cashfree webhook route never call the
  Subscriptions API, and must not start.
- **Also:** no failed-debit retries or dunning, and nothing that can charge a
  customer who stopped meaning to pay. Checkout is Cashfree's hosted flow via
  `payment_session_id`, so card data never touches this server.
- **The cost is real and large: manual-renewal churn.** Every renewal is a
  decision someone has to make, on a date they will not remember, and some
  fraction will simply not make it. Two things push back on that:
  - **Rollover credits give the renewal email a concrete hook.** Unspent
    credits carry into the next cycle (up to the plan's bank cap), but only
    for a tenant who renews before grace ends. So the reminder can say *"You
    have N unused credits. Renew before the grace period ends and they carry
    over"* (`lib/email/templates.js`), a specific loss rather than a
    generic nudge. The final grace email names the exact moment the balance
    is cleared.
  - **The reminder sequence:** `jobs/renewalReminderJob.js` sends at day 27,
    day 29, expiry day, and grace day 2, the last one a day before the
    3-day grace window closes
    ([§3](#3-entitlement-lifecycle-and-what-each-state-allows)).

  If renewal churn turns out to cost more than mandate drop-off, revisit this
  trade. That is a measurement question, not a reason to add mandates
  pre-launch.
- **Renewing early never loses days.** A purchase made while a plan is live
  extends from the current `validUntil`, not from today.
  `/api/billing/summary` returns the exact resulting dates (`renewal.validUntilByPlan`),
  computed with `grantPlan`'s own rule, so the page states a date rather than
  a promise.
- **A paid order is fulfilled exactly once.** The Cashfree webhook processes
  synchronously and returns 200 only after the write succeeds, so Cashfree
  retries on failure. `billingFulfillment.fulfillPaidOrder` is idempotent
  through a conditional `UPDATE … WHERE status = 'CREATED'`, and the nightly
  reconciliation job calls the same function for any webhook that never
  arrived.
- **Region lock.** The first payment with real evidence (a domestic-only rail,
  or a card country) locks `billingRegion`/`currency`. The currency the page
  showed is never evidence, since that would make VPN arbitrage trivial. An
  `UNVERIFIED` payment is granted normally but locks nothing.

## 2. The three flags

All default to off. Only the exact string `true` enables one. Each is read at
call time, not at load, so a flag is a real kill switch.

| Flag | Gates | While off |
|---|---|---|
| `BILLING_ENABLED` | The whole billing feature: `/api/billing/*`, the Cashfree webhook, the billing nav, enforcement (classification gate, auto-reply credit check), the billing jobs | Every billing route returns **404**, never 401/403, so a disabled route gives no signal that billing exists. Enforcement is inert: every tenant classifies freely. This is the intended state until Meta App Review lands. |
| `META_APPROVED` | The "Built on the official Instagram Graph API" half of the marketing trust badge | Hidden. The claim is not ours to make before approval. |
| `USD_PRICING_ENABLED` | Whether `/api/billing/plans` exposes USD/INTL prices | INR only. The USD rows stay in the database either way, so turning them on is a flag flip, never a migration. |

**One deliberate asymmetry.** The trial granted on Instagram *connect* is **not**
behind `BILLING_ENABLED`, and must not be. Trials accrue correctly while billing
is dark, so switching billing on finds everyone in the right state. The
*claim* endpoint (`POST /api/billing/trial/claim`) is behind the flag, like
every billing route. That is consistent with the connect grant: the card that
calls the endpoint only exists on billing surfaces, and with the flag off
nothing is gated, so there is nothing to claim.

## 3. Entitlement lifecycle and what each state allows

One `Entitlement` row per tenant. `status` defaults to `NONE`, so creating a row
can never grant anything by accident.

**Effective status is derived, not stored.** `validUntil` and `graceUntil` are
the source of truth. `effectiveStatus()` derives `TRIALING/ACTIVE → GRACE →
EXPIRED` at read time, and the stored `status` column is only caught up
eventually by a sweep. Nothing depends on the sweep having run.

| Effective status | Classification | Auto-reply | Notes |
|---|---|---|---|
| `NONE` / no row | no (`not_entitled`) | no | See [§6](#6-the-trial) for how a trial starts |
| `TRIALING` | yes, up to the trial cap | yes, while credits remain | 3 days, **no grace stage** |
| `ACTIVE` | yes | yes, while credits remain | Paid plan, 30-day cycle |
| `GRACE` | **yes** | **no** | `validUntil + 3 days`, paid plans only |
| `EXPIRED` | no | no | The inbox stays readable and nothing is deleted. The account is never locked, because a user who cannot log in cannot pay. |

Classification continues through grace because sorting is what keeps a lapsed
customer's inbox usable while they decide. Auto-reply stops, because it acts in
the customer's name and spends credits. A trial has no grace:
`graceUntil` stays null, so the same derivation falls straight from TRIALING to
EXPIRED.

Cycles roll on the clock, not only on payment. `jobs/entitlementCycleJob.js`
calls `rollCycle()` for tenants whose cycle elapsed without a purchase.
Otherwise a tenant in GRACE would stay pinned at last cycle's classification
count and hit the cap on messages they are still entitled to have sorted.

## 4. Plan changes, and why downgrades are blocked

Tiers, lowest first: `STARTER` (1) → `PRO` (2) → `ENTERPRISE` (3, quote-only).
`TRIAL` is not a tier. Every plan purchase goes through `grantPlan()`:

- **Warm renewal** (the tenant is TRIALING/ACTIVE/GRACE): the new period starts at
  the current `validUntil`. The unspent balance carries forward, capped at the
  **larger** of the old and new plans' bank caps. Where two caps could apply,
  the customer gets the benefit. Anything above the cap is discarded with an
  `EXPIRE` row.
- **Cold start** (no entitlement, or EXPIRED past grace): the period starts now,
  and any leftover balance is forfeited (`expire:cold_start_forfeit`).
- **Upgrades** are allowed at any time and take effect immediately.

**Downgrades are blocked while a paid plan is ACTIVE.** Checkout refuses a lower
tier with `409 PLAN_DOWNGRADE_BLOCKED` and the date the switch opens, which is
the current `validUntil`.

- **Why.** `grantPlan()` switches the plan immediately. A downgrade bought
  mid-period would cut short time the customer already paid for at the
  higher tier: they would lose Pro days they bought, in exchange for a cheaper
  plan they did not need yet.
  Deferring the switch inside `grantPlan()` would need a second "scheduled plan"
  state and everything that comes with it. Refusing the purchase until the paid
  period ends keeps one plan per tenant and loses nobody anything.
- **Why in the API, not just the UI.** A UI-only block is one stale tab or one
  crafted request away from charging someone for exactly that loss. The rule
  lives once, in `entitlementService.downgradeBlock()`. The checkout route
  enforces it, and `/summary` reports it (`planChange.blockedPlanCodes`,
  `availableFrom`), so a plan card never offers a purchase the API will refuse.
- **What is not blocked.** GRACE (the paid period is already over) and TRIAL
  (nothing paid to protect).
- **If a downgrade is granted anyway**, for example from an order that pre-dates
  the block or a path that bypassed checkout: the money is already taken, so
  the grant completes. Refusing would leave a PAID order with nothing granted,
  which nothing retries. After the grant commits,
  `alertPlanAnomaly()` emails `SUPPORT_EMAIL` through the CRITICAL tier, so a
  human looks at it.

## 5. Credits and the ledger invariant

Two balances on the entitlement:

- `replyCreditsCurrent`: credits granted this cycle (the plan grant plus packs
  bought during it)
- `replyCreditsBanked`: credits carried over from earlier cycles, capped by the
  plan's bank cap

Spend is FIFO, banked before current, one credit per auto-reply, atomically
(`spendReplyCredit`).

**The invariant: no operation may change credits without writing a
`CreditLedger` row.** For every tenant:

```
sum(credit_ledger.delta) == reply_credits_current + reply_credits_banked
```

**Why.** On a Pro → pack → Starter sequence, `grantPlan` once dropped 517
credits with no ledger row, and the trial grant once held 25 credits with no
GRANT row. The ledger is what a disputed balance is checked against, and once
it stops adding up it can no longer answer that question.

It is enforced twice: by `backend/tests/ledger-invariant.test.js` after every
grant, spend, add-on and roll, and against a live database by
`npm run billing:doctor`, which lists any entitlement whose balance disagrees
with its ledger.

Ledger row types:

| Type | Delta | Written by |
|---|---|---|
| `GRANT` | + | `plan_grant:<plan>`, `trial_grant`, add-on packs, `dev_grant` / `dev_topup` (local SQL only) |
| `SPEND` | −1 | `auto_reply_spend` |
| `EXPIRE` | − | Any discard; the `source` names the reason (below) |
| `ROLLOVER` | 0 | A cycle roll that lost nothing (`cycle_rollover`) |
| `CLASSIFY` | 0 | One per classified message. `@@unique([tenantId, messageId, type])` makes retries and AI-provider failover free: the same message never counts twice. |

`EXPIRE` reason codes:

| Source | When |
|---|---|
| `expire:cold_start_forfeit` | A plan is bought with no live entitlement; any leftover balance is forfeited |
| `expire:renewal_bank_cap` | Same-plan renewal; the carried balance is over the bank cap |
| `expire:plan_change_bank_cap` | Renewal onto a different plan; over the larger of the two caps |
| `expire:cycle_bank_cap` | `rollCycle()` without a renewal; over the bank cap |
| `expire:trial_grant_replaced_balance` | A trial is granted over a `NONE` row that somehow held credits |
| `expire:dev_reset_trial` | `scripts/dev-reset-trial.js --delete-entitlement` removed an entitlement holding credits (dev only) |

A new discard path must add a code here and write the row in the same
transaction as the balance change.

## 6. The trial

**Terms.** 3 days, 25 auto-reply credits, and a classification cap of 100. No grace,
and no payment details. The numbers come from the `TRIAL` catalogue row, except
the 25 credits, which the grant writes from `TRIAL_AUTO_REPLY_CREDITS`. The
migration `20260914154500_trial_auto_reply_credits` keeps the two equal;
change one and you must change the other.

**One trial per Instagram account, ever.** Not per email, and not per Siffty
account. `InstagramIdentity` records it:

- **It has no relation to `User` and survives account deletion.** Otherwise
  "delete your account and sign up again" is an unlimited free trial.
- **It is pseudonymised.** `igUserIdHash` is HMAC-SHA256 of the Instagram id under
  `IG_IDENTITY_PEPPER`. The raw id is never stored.
- **The pepper can never be rotated.** Change it and every row becomes
  unmatchable, which silently hands every past trial user a fresh trial.

**Two ways in, one set of rules.**

- **Connect:** the Instagram OAuth callback, through `claimInstagramIdentity()`
- **Claim:** `POST /api/billing/trial/claim`, through `claimTrialForUser()`, for an
  account that is *already* connected. It exists because the connect callback
  used to be the only way in. An account that became eligible after it was
  linked (a cleared stamp, a removed entitlement) could reach its trial only by
  disconnecting and reconnecting.

Both decide through `trialDecision()`, the **only copy** of the eligibility
rules, and both write through `grantTrialInTx()`, the only code that grants a
trial. `/summary` reports what a claim would do by calling `trialDecision()`
too. Two copies would drift, and whichever drifted looser would be the one
handing out free trials.

**Eligibility, in precedence order:**

| # | Condition | Outcome | Claim HTTP |
|---|---|---|---|
| 1 | Already has, or had, a trial or plan (entitlement status ≠ `NONE`) | `ALREADY_ENTITLED` | 200 (a double click lands here) |
| 2 | The identity's `trialConsumedAt` is set | `TRIAL_ALREADY_CONSUMED` | 409 |
| 3 | Every connected identity is blocked | `ACCOUNT_BLOCKED` | 403 |
| 4 | Email not confirmed | `EMAIL_UNVERIFIED` | 403 |
| 5 | No connected Instagram account | `TRIAL_NOT_STARTED` | 409 |
| — | Otherwise | granted → `TRIAL_GRANTED` | 200 |

A spent trial outranks an unconfirmed email because confirming the address
would not change the answer. `TRIAL_CLAIMABLE` is what `/summary` reports for
the "otherwise" row; a claim never returns it. `ACCOUNT_ALREADY_LINKED` is
connect-only: the account is actively linked to another workspace.

**`trialConsumedAt` is stamped only on a grant.** The stamp and the grant happen
in one transaction, or neither happens.

- **Why.** The stamp is a permanent record that this Instagram account had its
  one free trial. It used to be written whenever an account was connected,
  including when the connecting user already had a trial or plan and the
  account received nothing. That was a false record. It silently and
  permanently denied that account a legitimate trial later, on any Siffty
  account, for a trial it never had.
- **A refusal stamps nothing.** An unconfirmed email, a blocked account, or a
  user who is already entitled all leave the account able to earn its trial
  later.

**Exactly one trial under concurrency, without locks.** Each write in
`grantTrialInTx()` is conditional on the state the decision was made from:

- the stamp is written `WHERE trial_consumed_at IS NULL`
- the entitlement is created (unique `userId`), or a NONE row is lifted
  `WHERE status = 'NONE'`

A write that matches nothing throws. The transaction rolls back, including any
stamp it already wrote, and the decision re-runs once against the winner's
committed rows. So a double-clicked claim, or a claim racing a connect of a
second account, grants one trial and stamps one identity.
`backend/tests/trial-claim.test.js` pins all of this.

**What the pages show.** `/summary` returns `trialStatus` and
`instagramConnected`. `frontend/src/lib/trialState.js` picks the card on both
axes, because "no entitlement" and "no Instagram connected" are different
situations:

| Entitlement | Instagram | Shown |
|---|---|---|
| none | not connected | Connect card (or confirm-your-email) |
| none | connected | `TRIAL_CLAIMABLE` ("Start my trial"), `TRIAL_ALREADY_CONSUMED`, `EMAIL_UNVERIFIED`, or `ACCOUNT_BLOCKED`. **Never the connect card.** |
| trialing | connected | The same usage panels as paid plans; the "trial started" card once, right after the grant |
| paid | connected | Usage panels |

## 7. Classification gating

While `BILLING_ENABLED` is on, `messageAnalysisJob` asks
`classificationGateReason()` before running AI on an inbound DM:

| Reason | Meaning | What happens to the message |
|---|---|---|
| `ok` | Entitled and under limits | Classified |
| `hourly_throttle` | Over the plan's hourly burst guard | Re-queued with a delay; the only reason that clears by itself |
| `cycle_cap` | Over the plan's per-cycle cap | `aiStatus: 'skipped'` |
| `not_entitled` | No live entitlement (NONE/EXPIRED, or no plan row) | `aiStatus: 'skipped'` |

The message is stored and visible in the inbox either way; only the AI layer is
withheld. The gate is also a spend control: without it, an expired tenant's DMs
keep costing model calls indefinitely.

**Caps are fair-use guards, not sold quantities.** The paid plans' classification
cap and hourly throttle are enforced but never published: not on a page, and
not through `/plans` or `/summary`. Only the trial's cap is shown, because it is
part of the trial offer.

## 8. First deploy

Code and schema ship by **two separate mechanisms**. Merging to `master`
auto-deploys the code. `prisma migrate deploy` is run **by hand** in the service
shell, never on container start. `docs/ENV-SETUP.md` §1 has the full reasoning.
In short:

1. **Set the environment first.** The three flags stay `false`. Set
   `CASHFREE_APP_ID` and `CASHFREE_SECRET_KEY` (the secret key is also the
   webhook signing secret; there is no separate one), `SUPPORT_EMAIL`,
   `FRONTEND_URL`, `BACKEND_URL`, and `IG_IDENTITY_PEPPER` (never to be rotated).
2. **Merge to `master`.** The new container will **refuse to start**:
   `lib/migrationGuard.js` exits when the database is behind the code. That is
   the guard doing its job, not a broken deploy. Serving new code against the
   old schema breaks Instagram connect for every user while `/health` stays green.
3. **In the service shell**, if the app has run on this database before, adopt
   the session table first:
   `prisma migrate resolve --applied 20260914064610_adopt_user_sessions`
4. Run `./node_modules/.bin/prisma migrate deploy`.
5. **Restart.** The guard passes and the service serves.
6. Run `npm run billing:doctor`. It checks the flags, credentials, Prisma client,
   migrations, catalogue, and the ledger invariant, and prints no secrets.
7. **Do not promote** `backend/prisma/pending-approval/20260914064620_drop_subscriptions_legacy`.
   It destroys pre-Entitlement trial data and waits on a production survey,
   a verified backfill, and explicit owner approval.
8. Turn `BILLING_ENABLED` on only after Meta App Review. Editing env vars needs
   a restart.

## 9. Local development: granting and resetting trials

Full SQL and commands are in `docs/ENV-SETUP.md` §5. **None of this is for
production.** Remember that `node --watch` does not watch `.env`, so a flag
change needs a full restart.

**Grant a trial the real way.** Connect an Instagram account whose identity has
never had one. If the account is already connected and claimable, press
**Start my trial** on `/billing`.

**Grant without Instagram** (users who predate billing are otherwise gated off):
§5.1 inserts a long-lived TRIAL entitlement for every user missing one, **and
the matching `dev_grant` ledger rows**. Skip the ledger rows and
`billing:doctor` reports drift.

**Keep a local trial alive:** §5.2 extends `validUntil` and resets `status`.
The one-year TRIAL on `admin@codeback.internal` is such a grant, and is
deliberate (see the note in §5.2).

**Top up credits:** §5.3, where the balance update and its `dev_topup` ledger
row are one statement.

**Re-test the grant path with the same Instagram account** (§5.5):

```bash
# from backend/ — dry run: shows the stamp, link count, and who it is connected to
node scripts/dev-reset-trial.js @instagram_username
# clear trialConsumedAt
node scripts/dev-reset-trial.js @instagram_username --apply
# also delete the connected user's entitlement (needed if they are already
# TRIALING — a grant never resets an existing trial or plan); writes an
# expire:dev_reset_trial row if it held credits
node scripts/dev-reset-trial.js @instagram_username --apply --delete-entitlement
```

Then press **Start my trial** on `/billing`; no reconnect is needed. The script
refuses to run when `NODE_ENV=production` or when `DATABASE_URL` is not
localhost, and changes nothing without `--apply`.

**Start over:** §5.4 deletes all entitlements *and* the ledger, which has no
foreign key and would otherwise outlive them.

**When something "does nothing":** run `npm run billing:doctor` first. A flag
that is off, a missing credential, a database behind the code, a stale Prisma
client, and an empty catalogue all look identical from the UI.
