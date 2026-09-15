# Environment and deploy setup

> Names and descriptions only. **No values appear in this file, ever** —
> not examples, not placeholders that look real, not "expired" ones.

---

## Contents

1. Deploy sequence
2. Environment variables introduced by the billing work
3. The readiness check — `npm run billing:doctor`
4. What to expect in the Cashfree dashboard
5. Running local development with billing ON

---

## 1. Deploy sequence — read before the first deploy of the billing work

### The gap this exists to close

Code and schema are deployed by **two different mechanisms, at two
different times**:

| | Trigger | Who runs it |
|---|---|---|
| **Code** | push to `master` | Northflank, automatically |
| **Schema** | `prisma migrate deploy` | a human, by hand, in the service shell |

There is no release command, no Dockerfile migration, and no entrypoint
migration — `npm start` is bare `node src/index.js`. That decoupling is
deliberate (`docs/DEPLOYMENT-RUNBOOK.md` PHASE 4: *"Manually, in the service
shell. Never on container start"*), because an automatic migration on every
container start is its own class of outage.

But it means **merging to `master` puts new code live against the old
schema** until someone runs the migration, and the window stays open
indefinitely if that step is forgotten.

### Why that is not a small window

Prisma Client SELECTs every column its schema declares. A client built from
a schema containing `entitlements.region_source` emits that column against a
database that does not have it yet, and **every full-row entitlement query
throws**.

`claimInstagramIdentity()` reads and writes the full entitlement row inside a
transaction, so the transaction aborts and **Instagram connect fails for
every user** — including with `BILLING_ENABLED` off, because the trial grant
is not behind that flag and must not be. Meanwhile `/health` still returns
200 and nothing else misbehaves. It is silent.

This is not hypothetical. It happened on the local development database
during this work and is exactly how it presented: connect broken, everything
else fine, no error anywhere obvious.

### The guard

`backend/src/lib/migrationGuard.js` runs before the HTTP socket opens. It
compares migration folders on disk against `_prisma_migrations`, and if the
database is behind it **prints the missing migration names and exits(1)**.

- It **does not run migrations.** Reporting only — running them here would
  reintroduce the container-start migration the runbook rules out.
- A database that is *unreachable* at boot is a warning, not a fatal: that is
  a transient condition the app already handles per-request, and refusing to
  start would turn a blip into an outage needing a human. Only a database we
  can read, and which is definitively behind, stops the boot.

A process that refuses to start is loud and diagnosed in seconds. A process
serving a broken connect flow costs signups until someone reports it.

### The correct order

```bash
# 1. Merge to master. Northflank deploys the code.
#    The new container WILL refuse to start if the schema is behind —
#    that is the guard doing its job, not a broken deploy.

# 2. In the Northflank service shell, apply the schema:
./node_modules/.bin/prisma migrate deploy

# 3. Restart / redeploy the service. The guard now passes and it serves.
```

If step 2 is skipped, step 3 never comes up healthy and the logs name the
exact missing migrations.

### One-off: adopting `user_sessions`

`connect-pg-simple` creates its own session table at runtime, so on any
database where the app has already run, `user_sessions` **already exists**
and `20260914064610_adopt_user_sessions` will fail with
`relation "user_sessions" already exists`.

Adopt it instead of running it — this records the migration as applied
without executing its SQL:

```bash
./node_modules/.bin/prisma migrate resolve --applied 20260914064610_adopt_user_sessions
```

Then continue with `migrate deploy`. This exact sequence was rehearsed on
the local development database and is what repaired it. On a genuinely fresh
database that has never run the app, the migration applies normally and no
resolve is needed.

### Migrations deliberately held back

`backend/prisma/pending-approval/` contains finished migrations that **must
not run yet**, kept out of `prisma/migrations/` because `migrate deploy`
applies *everything* it finds there — there is no "apply all but this one".

Currently held: `20260914064620_drop_subscriptions_legacy`, the irreversible
destruction of the pre-Entitlement trial data. It waits on a production
survey, a verified backfill, and explicit owner approval. See that folder's
README for how to promote one.

---

## 2. Environment variables introduced by the billing work

> Names and descriptions only. Set the values yourself — in Northflank for
> production, in `backend/.env` for local development. **No agent has ever
> written or read a value into either**, by instruction, and none appears
> anywhere in this repository.

### Feature flags — not secrets, safe to name anywhere

All three default to **false**, and only the exact string `true` enables
them. Anything else (including `TRUE`, `1`, `yes`) reads as false — see
`backend/src/lib/billingFlags.js`.

| Variable | Where | Purpose |
|---|---|---|
| `BILLING_ENABLED` | backend | Master switch. While false, `/api/billing/*` returns **404** regardless of auth, the billing nav entry is hidden, enforcement is inert, and the billing jobs do not run. This is the intended state until Meta App Review lands. |
| `META_APPROVED` | backend | Reveals the "Built on the official Instagram Graph API" half of the marketing trust badge. Keep false until approval has actually landed — the claim is not ours to make before then. |
| `USD_PRICING_ENABLED` | backend | Exposes USD/INTL prices through `/api/billing/plans`. The USD rows are in the database either way, so turning international pricing on is a flag flip, never a migration. |

These are read at call time, not at module load, so a flag is a genuine kill
switch rather than something frozen at boot.

### Cashfree credentials — SECRETS

| Variable | Where | Purpose |
|---|---|---|
| `CASHFREE_APP_ID` | backend, secret | Cashfree client id, sent as `x-client-id` on order creation. |
| `CASHFREE_SECRET_KEY` | backend, secret | Cashfree client secret, sent as `x-client-secret`. |

> **`CASHFREE_SECRET_KEY` doubles as the webhook signing secret.** Cashfree
> does not issue a separate one — webhook signatures are HMAC-SHA256 over
> `timestamp + raw body`, keyed with the **client secret**. There is nothing
> else to configure, and there is no `CASHFREE_WEBHOOK_SECRET`. The
> consequence of getting this wrong is quiet: checkout fails loudly, but a
> bad signing secret makes every inbound webhook fail verification and be
> rejected with a 401 that only appears in logs.

Sandbox and production are different hosts, selected by `NODE_ENV` — the
same credentials do **not** work against both.

### Running production against Cashfree's TEST account

Until the live Cashfree account is activated, production can take checkouts
in test mode (test cards, no real money). Two settings, and **both** must be
set, because a checkout session created on one Cashfree environment cannot be
opened in the other:

| Variable | Where | Value | Effect |
|---|---|---|---|
| `CASHFREE_ENV` | backend runtime | `sandbox` or `production` | Which Cashfree API the backend calls. Unset: `NODE_ENV` decides (production → live). Any other value is ignored. |
| `NEXT_PUBLIC_CASHFREE_MODE` | frontend **build-time** | `sandbox` or `production` | Which mode the browser checkout opens in. Inlined at build, so changing it needs a frontend rebuild. |

Pair them with the matching keys: test mode needs the **sandbox** App ID and
Secret Key. To go live, set both to `production` (or remove both), replace
the keys with Production-mode keys, rebuild the frontend and restart the
backend.

### Related, pre-existing

| Variable | Where | Purpose |
|---|---|---|
| `SUPPORT_EMAIL` | backend | Recipient for the reconciliation mismatch digest (a mismatch means money is unaccounted for). Without it the digest degrades to a log line. |
| `FRONTEND_URL` | backend | Builds the prefilled renewal checkout links. Already fatal in production if unset or pointing at localhost. |
| `BACKEND_URL` | backend | Becomes the `notify_url` given to Cashfree — where webhooks are delivered. |

---

## 3. The readiness check

```bash
cd backend && npm run billing:doctor
```

Prints one table: each flag's effective value, whether each Cashfree
credential is **present or absent** (never the value — the output is safe to
paste into a chat or an issue), whether the database matches the migration
directory, whether the Prisma client is current, and how many plans and
prices are seeded.

It exists because every "why do I see nothing" moment in this project has had
one of those five causes, all of which produce the identical symptom — a page
showing nothing — and none of which says so. Exit code is non-zero only for
genuine problems, so it also works as a deploy check.

If `BILLING_ENABLED` is off it says so explicitly and calls that the intended
pre-launch state rather than flagging it as a fault.

---

## 4. What to expect in the Cashfree dashboard

Short version: **almost nothing, and that is correct.**

- **No environment file was ever written by an agent, by instruction.** Every
  credential is set by the owner — Northflank for production, `backend/.env`
  for local. Agents were told never to write or print secrets, so the absence
  of changes there is correct behaviour, not a missed step.

- **The MCP connection was used for development inspection only** — creating
  one sandbox test order and reading it back to confirm the request/response
  shape. The production runtime path makes plain server-side REST calls with
  env-var credentials (`backend/src/lib/cashfreeOrders.js`). MCP is not a
  runtime dependency and nothing in the deployed application talks to it.

- **Exactly one artifact exists**: sandbox order `siffty-gate3-test-001`
  (₹499, created, never paid). It is in the **SANDBOX** environment. If the
  dashboard is toggled to Production it will show nothing at all — correctly,
  because no production order has ever been created.

- **Nothing further appears until a real sandbox payment is run** through the
  billing page. That is the follow-up to Gate 6 and is the owner's step, not
  an agent's: it needs real credentials and a real card/UPI flow.

The webhook itself has been verified end to end, but with a synthetic
self-signed request rather than a Cashfree-originated one — signature
rejection, idempotent grant, and replay protection all confirmed against the
real handler. A live payment is what remains untested.

---

## 5. Running local development with billing ON

Turning `BILLING_ENABLED=true` on a development database makes enforcement
live, and enforcement **fails closed**. Two things then bite, both silent.

> Remember that editing `.env` needs a full restart — `node --watch` does not
> watch it. See DEPLOYMENT-RUNBOOK §2.6.

### 5.1 A tenant with no entitlement row is gated off entirely

`classificationGateReason()` returns `not_entitled` when a tenant has no
entitlement, so inbound DMs are marked `aiStatus: 'skipped'` and never
classified. Nothing errors. The inbox simply stops thinking.

Entitlements are created by `claimInstagramIdentity()` when an Instagram
account is connected, so **any user who connected before the billing work
existed has no entitlement row at all**. On this repo's local database that was
every one of the 6 users, against 3 connected accounts.

Check first — if this returns anything, those users are gated off:

```sql
SELECT u."email"
FROM "users" u
LEFT JOIN "entitlements" e ON e."user_id" = u."id"
WHERE e."id" IS NULL;
```

Grant a long-lived trial to everyone missing one. Additive and idempotent —
it touches no existing entitlement:

```sql
INSERT INTO "entitlements"
  ("id", "user_id", "plan_code", "status", "cycle_started_at", "valid_until",
   "reply_credits_current", "hour_window_started_at", "created_at", "updated_at")
SELECT gen_random_uuid()::text, u."id", 'TRIAL', 'TRIALING',
       now(), now() + interval '365 days',
       25, now(), now(), now()
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "entitlements" e WHERE e."user_id" = u."id");
```

**Then record those credits in the ledger.** No operation may change credits
without a ledger row, and `npm run billing:doctor` fails on any entitlement
whose balance differs from its ledger sum. This writes one GRANT row for each
entitlement that holds credits but has no ledger history at all:

```sql
INSERT INTO "credit_ledger" ("id", "tenant_id", "delta", "type", "source", "balance_after")
SELECT gen_random_uuid()::text, e."user_id",
       e."reply_credits_current" + e."reply_credits_banked", 'GRANT', 'dev_grant',
       e."reply_credits_current" + e."reply_credits_banked"
FROM "entitlements" e
WHERE e."reply_credits_current" + e."reply_credits_banked" > 0
  AND NOT EXISTS (SELECT 1 FROM "credit_ledger" l WHERE l."tenant_id" = e."user_id");
```

`id` and `updated_at` have no database default — Prisma normally supplies both
— so raw SQL must pass them or the INSERT fails on a NOT NULL violation.

### 5.2 Yes — a locally created trial's `validUntil` needs extending

A real trial is `TRIAL_DAYS = 3`. A trial created by connecting an account on
Monday stops auto-replying on Thursday, and after the grace window the inbox
goes read-only. For day-to-day development that expiry is pure friction: it
arrives without warning and looks exactly like a broken feature.

So extend it. This is the UPDATE:

```sql
UPDATE "entitlements"
SET "valid_until" = now() + interval '365 days',
    "status"      = 'TRIALING',
    "updated_at"  = now()
WHERE "plan_code" = 'TRIAL';
```

`status` is reset alongside the date because a trial that already lapsed may
be sitting at `EXPIRED`; moving the date alone would leave a row that is
live by `validUntil` and dead by its stored status.

Do **not** carry this habit to production. Extending `validUntil` there hands
out free service, and the derived-status design means the row is believed.

> **A deliberate dev grant on this repo's local database.**
> `admin@codeback.internal` holds a TRIAL entitlement valid until
> **2027-09-14** — a one-year trial made by the §5.1 INSERT and §5.2 UPDATE
> above, with its matching `dev_grant` ledger row, so `billing:doctor`
> balances. It is intentional, not a bug and not a real trial: that account has
> no Instagram identity, so nothing was stamped and the one-trial-per-account
> rule is untouched. Delete it with §5.4 if you want the admin account to show
> the no-trial states.

### 5.3 Topping up reply credits during development

A trial grants 25 auto-reply credits, which is deliberately small — enough to
watch the feature work, not enough to develop against for a week. When a tenant
stops replying and `canAutoReply()` is the reason, top up rather than raising
the constant:

The top-up and its ledger row are one statement, so the two cannot come apart
(a bare UPDATE would show up as drift in `billing:doctor`). This ADDS 500:

```sql
WITH topped AS (
  UPDATE "entitlements"
     SET "reply_credits_current" = "reply_credits_current" + 500, "updated_at" = now()
   WHERE "user_id" = (SELECT "id" FROM "users" WHERE "email" = 'you@example.com')
  RETURNING "user_id", "reply_credits_current" + "reply_credits_banked" AS balance
)
INSERT INTO "credit_ledger" ("id", "tenant_id", "delta", "type", "source", "balance_after")
SELECT gen_random_uuid()::text, "user_id", 500, 'GRANT', 'dev_topup', balance FROM topped;
```

Classification counters reset per cycle on their own, but if the burst guard
is in the way mid-session, clear it the same way:

```sql
UPDATE "entitlements"
SET "classification_count_cycle" = 0, "classification_count_hour" = 0,
    "hour_window_started_at" = now(), "updated_at" = now()
WHERE "user_id" = (SELECT "id" FROM "users" WHERE "email" = 'you@example.com');
```

### 5.4 Undoing all of it

```sql
DELETE FROM "credit_ledger";
DELETE FROM "entitlements";
```

The ledger goes too: ledger rows have no foreign key and would otherwise
outlive the entitlements, so the next grant to the same user would start from
a ledger sum that no longer matches anything.

Entitlements cascade from `users` and are rebuilt by connecting an Instagram
account, so this is safe on a development database and destroys nothing else.
It is not safe anywhere else.

### 5.5 Re-testing the trial locally — clear `trialConsumedAt` (DEV ONLY)

> **DEV ONLY. NEVER RUN THIS AGAINST PRODUCTION.**
>
> `trialConsumedAt` on an Instagram identity is the only thing that stops
> "delete your account and sign up again" from being an unlimited free trial.
> It deliberately survives account deletion. Clearing it in production hands
> that Instagram account a second free trial, and leaves no record it ever
> had a first one.

**Why you need it.** One free trial per Instagram account, ever. After an
account has connected once, every later connect — from any Siffty user,
including one you just deleted and re-registered — correctly grants nothing
and shows "This Instagram account has already used its free trial". That is
the right behaviour, and it means the grant path cannot be re-tested with the
same Instagram account without clearing the stamp.

The pepper-derived hash cannot be computed in SQL, so use the script. It
**refuses to run** when `NODE_ENV=production` or when `DATABASE_URL` is not a
localhost database, and it changes nothing without `--apply`:

```bash
# from backend/ — dry run first: shows the stamp, link count, and who it is connected to
node scripts/dev-reset-trial.js @your_instagram_username
```

```bash
# clear the stamp
node scripts/dev-reset-trial.js @your_instagram_username --apply
```

```bash
# ALSO delete the connected user's entitlement — needed if that user is already
# TRIALING, because the grant never resets an existing trial or plan
node scripts/dev-reset-trial.js @your_instagram_username --apply --delete-entitlement
```

Then, in the app, press **Start my trial** on `/billing`. The account is still
connected and is now claimable, so `POST /api/billing/trial/claim` grants the
trial through the same rules as a connect — no disconnect needed. (Disconnecting
and reconnecting still works too; that redirect carries `?trial=TRIAL_GRANTED`.)
Either way the billing page should show a 25-credit trial ending three days
from now.

`--ig-user-id <id>` works in place of `@username`. `blockedAt` is never touched.
