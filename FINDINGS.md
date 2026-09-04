# FINDINGS

---

# ⚠ DEPLOYMENT PREREQUISITE — READ BEFORE THE FIRST DEPLOY

**Status: NOT DONE. Nobody has run the production survey yet. Do not deploy
until this section is worked through.**

The local dev database was found **drifted** from the repo, and production is
assumed drifted the same way until proven otherwise. If it is, `prisma migrate
deploy` may behave differently there than it does locally, and the local
"everything is green" result does not transfer.

### What drift looks like

Dev carried three migrations whose files no longer exist in the repo — deleted
by the revert of the Cashfree billing work (`39f84a6`):

```
20260831071203_add_plan_and_billing_fields
20260831071502_drop_subscription_legacy_plan
20260831160644_add_subscription_renewal_reminder_field
```

They left behind orphan tables — `plans`, `processed_webhook_events`, and an
**old-shape** `subscriptions` (recognisable by a `plan_id` or
`provider_subscription_id` column) — and dev had never received
`20260903120000_remove_subscription_and_usage`.

### Step 0 — find out, before touching anything

```bash
DATABASE_URL="<northflank-postgres-url>" node backend/scripts/prod-readonly-survey.js
```

SELECT-only. Its Q0 section prints the full migration history, classifies each
row as PHANTOM (applied, no file) or MISSING (file, not applied), lists every
table, and flags orphans and the `subscriptions` shape. **If it reports no
phantom migrations, none of the rest of this section applies.**

### Step 1 — snapshot Northflank first

Take a database snapshot/backup through the Northflank UI and **confirm it
completed** before running anything below. Everything after this point is
destructive and none of it is reversible without that snapshot.

### Step 2 — check whether the pipeline auto-runs migrations

Find out whether the Northflank deploy pipeline runs `prisma migrate deploy`
automatically on release (a build/release command, an entrypoint script, or a
job). This decides the entire approach:

- **If it auto-runs**, a deploy will apply pending migrations *before* anyone
  has cleaned up. Pause the pipeline, or complete the cleanup first.
- **If it is manual**, cleanup and migration can be sequenced deliberately.

Note that `20260904160000_auth_hardening_baseline` is safe to *attempt* on a
drifted database — its Section 0 preconditions abort the whole transaction and
roll back rather than applying partially. A failed attempt is not a broken
database. That is the safety net, not the plan.

### Step 3 — ORDER MATTERS: drop orphan tables BEFORE clearing history rows

Doing it the other way round leaves tables that no migration creates and no
migration drops, and nothing in the history explains them — the exact state that
produced this mess.

```sql
-- 3a. Orphan tables. Drop the FK holder first: subscriptions.plan_id
--     references plans.
--     Old-shape subscriptions ONLY — verify it has plan_id /
--     provider_subscription_id before dropping. The NEW trial-only
--     subscriptions table has neither and MUST NOT be dropped.
DROP TABLE IF EXISTS "subscriptions" CASCADE;   -- old shape only
DROP TABLE IF EXISTS "usage_events"  CASCADE;
DROP TABLE IF EXISTS "plans"         CASCADE;
DROP TABLE IF EXISTS "processed_webhook_events" CASCADE;

-- 3b. ONLY THEN reconcile the phantom history rows.
DELETE FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260831071203_add_plan_and_billing_fields',
  '20260831071502_drop_subscription_legacy_plan',
  '20260831160644_add_subscription_renewal_reminder_field'
);
```

Prisma offers no supported command to forget an applied migration
(`migrate resolve` marks one applied or rolled back; it cannot remove a row for
a migration whose file is gone). Deleting the rows directly is the only route,
which is why the snapshot in Step 1 is mandatory.

Archive the `plans` rows first if the snapshot is not enough — they are already
captured in `docs/pricing-history.md`, which is the only surviving record of the
pre-revert pricing.

### Step 4 — then migrate

```bash
npx prisma migrate deploy
```

Applies `20260903120000_remove_subscription_and_usage` (now a no-op for the
tables already dropped in 3a) followed by
`20260904160000_auth_hardening_baseline`.

### Step 5 — verify

Re-run the survey. Expect: zero phantom migrations, zero orphan tables,
`subscriptions` present in the **new trial-only shape**, and `webhook_deliveries`
present.

Then run the token backfill and confirm zero plaintext rows remain —
see **D3**, which governs when the `crypto.js` passthrough may finally be
removed. That is a separate, later change and is NOT part of this workstream.

---

Issues found during the Gate 0 audit of the auth/security hardening pass that are
**deliberately not being fixed** in that pass. Recorded so they are not lost, and so
the decisions behind them are not re-litigated from scratch in six months.

Each entry says what is wrong, where, and why it was deferred rather than fixed.

---

## Decisions — do not undo these without reading the reasoning

### D1. Do not add `helmet`

**Decision:** `helmet` is deliberately NOT a dependency. Keep the hand-rolled
`securityHeaders` in `backend/src/lib/security.js:112-125`.

**Why.** `res.setHeader` overwrites rather than merges, so whichever of helmet /
`securityHeaders` runs last wins every shared header. Adding `helmet()` after
`securityHeaders` is a **security regression**, not an improvement:

| Header | Current (`securityHeaders`) | helmet default |
|---|---|---|
| `X-Frame-Options` | `DENY` | `SAMEORIGIN` (weaker) |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'` | `default-src 'self'; frame-ancestors 'self'` (weaker) |

helmet also sets HSTS unconditionally (365 days, `includeSubDomains`), whereas
`security.js:121-123` gates it on production. Because the local dev server serves
HTTPS whenever `backend/certs/` exists (`index.js:49-63`), adding helmet would pin
`local.codeback.test` to HTTPS in every developer's browser for a year and break
plain-HTTP work on sibling hostnames.

The backend serves JSON and two tiny text/redirect responses. The locked-down CSP is
correct for that surface and stricter than anything helmet would give us.

**If you still want helmet later:** configure it explicitly
(`frameguard: { action: 'deny' }`, explicit CSP directives, `hsts` gated on
production) and DELETE `securityHeaders` — do not stack the two.

**Genuinely missing** relative to helmet's default set, worth adding individually to
`securityHeaders` if wanted: `Cross-Origin-Resource-Policy`, `Origin-Agent-Cluster`,
`X-DNS-Prefetch-Control`, `X-Permitted-Cross-Domain-Policies`, `X-XSS-Protection: 0`.

### D3. The `crypto.js` plaintext passthrough must OUTLIVE the token backfill

**Decision:** deleting the "legacy plain-text token" passthrough at
`backend/src/lib/crypto.js:70-73` and running the encryption backfill are **two
separate commits**, with production verification in between. They must NOT land
together.

**Why.** That passthrough is the only thing keeping any remaining plaintext token
functional. `decrypt()` returns its input verbatim when the value has no colon, so a
pre-encryption row still works today. Remove it in the same commit as the backfill and
the ordering risk is silent and severe: any row the backfill missed — in ANY
environment, including one nobody surveyed — stops being passed through and instead
gets parsed as `iv:ciphertext:tag`, fails, and ships ciphertext (or throws) straight at
the Meta Graph API. The symptom surfaces as an opaque Meta error, far from the cause.

**Required order:**

1. **Commit 1** — backfill: encrypt every plaintext token in place. Passthrough stays.
2. **Verify** — confirm zero plaintext rows in **every** environment, production
   included, using `backend/scripts/prod-readonly-survey.js` (Q6 section).
3. **Commit 2** — only then delete the passthrough, and make an unset
   `TOKEN_ENCRYPTION_KEY` fail at boot.

The dev database showing zero plaintext rows does **not** authorize step 3. Dev proving
`0/1` rows says nothing about production.

**Supersedes** the earlier instruction that the backfill and the passthrough deletion
land in the same commit.

### D2. `Message.igMessageId` uniqueness stays GLOBAL, not tenant-scoped

Meta's `mid` is globally unique by construction, so a global constraint is
semantically correct. With one active link enforced per Instagram account
(`ig_one_active_link`), the same `mid` cannot reach two tenants anyway.

The real gap is nullable mids getting no dedupe at all — tracked separately as
part of the Phase 6 work, not here.

---

### D4. `webhook_deliveries` MUST have a 7-day purge job — Gate 4, mandatory

`webhook_deliveries` provides delivery-level webhook idempotency, keyed on
SHA-256 of the raw request body. Unlike the `processed_webhook_events` table it
replaces — which only ever saw 13 Cashfree payment events — **every inbound
Instagram DM writes a row here**. It grows without bound.

A 7-day purge job is a **requirement of the design, not a nice-to-have**.
`received_at` is indexed specifically for it. Meta does not retry a delivery for
anything close to 7 days, so nothing is lost by purging at that age.

Without the job this table becomes the largest in the database and the unique
index on it degrades the webhook hot path — which is the one path that must stay
fast enough to return 200 inside Meta's timeout.

**Why the key is a body hash, not `(entry.id, entry.time)`:** two genuinely
different deliveries for the same account within the same second would collide
on that pair, and the second — a real customer message — would be silently
dropped. A body hash cannot collide across different deliveries. If Meta ever
re-serializes a retry, the hash simply differs and processing falls through to
the existing message-level dedupe on `Message.igMessageId`, which is today's
behaviour. The failure direction is safe by construction.

**Why a new table name:** the orphaned `processed_webhook_events` still exists
on any database that applied the phantom Cashfree migrations. Recreating that
name would make the migration fail precisely on the drifted databases it is
meant to fix.

## Credentials — handled outside the repo, do not touch in code

### C1. Hardcoded admin credentials in a tracked file

`backend/scripts/test-isolation.js:256-257` falls back to a hardcoded admin username
and password when `ADMIN_USERNAME` / `ADMIN_PASSWORD` are unset. Per
`backend/src/routes/admin.js`'s own comment, an admin session can impersonate any
tenant, which makes this credential class "a master key to every customer's DMs."

The file is tracked in git, so the value is in history regardless of what happens to
the working tree.

**Status:** owner is rotating this outside the repo. Deliberately not modified here.
**Still worth doing later:** make the script require the env vars instead of
defaulting, so the fallback cannot be reintroduced.

### C2. Live Cashfree merchant credentials in `backend/.env`

`backend/.env` lines 48-67 carry a `# ---- Billing (Cashfree) ----` block with five
variables referenced by **zero code** anywhere in the repo:
`CASHFREE_SUBSCRIPTIONS_CLIENT_ID`, `CASHFREE_SUBSCRIPTIONS_CLIENT_SECRET`,
`CASHFREE_PG_CLIENT_ID`, `CASHFREE_PG_CLIENT_SECRET`,
`CASHFREE_SUBSCRIPTIONS_ENABLED`.

They are dead weight with a live blast radius — nothing reads them, so removing or
rotating them costs nothing.

**Status:** owner is rotating this outside the repo. Deliberately not modified here.

**Correction to the original instruction:** these were also to be deleted from
`.env.example`, but **`.env.example` has no Cashfree entries** — the revert
(`39f84a6`) cleaned it correctly. The variables exist only in `backend/.env`, which is
gitignored and untracked. Nothing to delete.

---

## Deferred defects

### F1. Admin logout can leave a live cross-tenant session — PULLED INTO GATE 3

`backend/src/routes/admin.js:170-184`. `POST /api/admin/logout` deletes
`isAdmin` / `adminUsername` / `adminUserId`, but:

- deletes `userId` only `if (req.session.userId && !req.session.igUsername)`, and
- never touches `impersonatedUserId` / `adminOriginalUserId`.

An admin who logs out **while still impersonating** keeps a session that is a fully
authenticated ordinary session for the **victim's** tenant, with no admin marker and
no further audit trail. The `!igUsername` heuristic was written against the OAuth
session shape and does not know about the password-login shape (`auth.js:167` never
sets `igUsername`), so it also silently logs out admins who are ordinary users.

**Not deferred** — this is a live privilege-escalation path with no audit trail, so it
is being fixed as part of Phase 4 (Gate 3).

### F2. Admin refresh-token button uses the wrong grant — DEFERRED TO GATE 4

`backend/src/routes/admin.js:616-670`. `POST /api/admin/accounts/:id/refresh-token`
decrypts an already-long-lived token and calls `exchangeForLongLivedToken`, i.e.
`grant_type=ig_exchange_token` — which expects a *short*-lived token. Meta's refresh
grant for Instagram Login long-lived tokens is `ig_refresh_token`.

The call is expected to be rejected, and the catch at `:658-663` then writes
`tokenStatus: 'NEEDS_RECONNECT'`. So the one manual refresh button most likely marks
**healthy accounts broken**.

Deferred to Gate 4 / Phase 7 because it is the same code path as the token-expiry job.

Related, same area: `admin.js:660-663` runs a Prisma `update` *inside* a `catch`
block; if that update itself rejects it escapes as an unhandled rejection.

### F3. No global error handler — Phase 5

Nothing is registered after the last route mount in `backend/src/index.js`. Body-parser
errors surface through Express's default handler, which renders an HTML page with a
stack trace outside production.

This became **more reachable** with the raw-body change (pre-commit C): a body over
the new `1mb` limit now returns a 413 whose body is Express's default HTML error page.
Verified directly:

```
POST /api/conversations?x=webhook  (2MB body)
  -> 413  <!DOCTYPE html>...<pre>PayloadTooLargeE...
```

The 413 itself is correct and is the fix for an unauthenticated memory-exhaustion
vector. The HTML/stack-trace response body is the remaining defect. Add a JSON error
handler and a 404 handler in Phase 5.

### F4. `isSuspended` is enforced only at the login boundary — Phase 4

`auth.js:156` blocks a new login and `adminAuth.js:35` blocks the admin role path, but
`middleware/auth.js:8-20` (`requireAuth`) never checks it, and
`POST /api/admin/users/:id/suspend` neither destroys sessions nor calls
`disconnectUserSockets`.

A user suspended while logged in keeps full access to every `/api` route and their
socket room until the 7-day cookie expires.

Being fixed in Phase 4 as part of the single `requireAuth` lookup that also carries
`sessionVersion` and row existence.

### F5. Admin identity is keyed on a mutable Instagram username — Phase 4

`backend/src/middleware/adminAuth.js:46-51` grants admin when an entry in
`ADMIN_EMAILS` matches a connected account's `igUsername` (bare or `@`-prefixed), and
`:58-63` then **permanently writes `role: 'ADMIN'`** to that user's row.

Instagram handles are globally unique so a live handle cannot be squatted, but a
renamed or released handle can be. Admin identity should key on a stable id.

### F6. Rate limiter is bypassable by path casing, and is a memory-growth vector — Phase 5

`backend/src/lib/rateLimit.js:27` keys on `${ip}:${req.baseUrl}${req.path}`. The
routers are created with default options, so `caseSensitive` and `strict` are both
false — `/auth/login`, `/auth/LOGIN`, and `/auth/login/` all route to the same handler
but produce **three different counter buckets**. An attacker gets the full limit again
per spelling variant.

The same trick inserts unbounded distinct keys into the in-memory `Map`, which only
expire after `windowMs` (1 hour for register).

Also: per-IP only, never per-account, so distributed credential stuffing against one
account is unthrottled. Being replaced in Phase 5.

### F7. Login user-enumeration via timing, and outright via register — Phase 1

The 401 bodies for "no such user" and "wrong password" are byte-identical, which is
correct. But `auth.js:147` returns **before** `bcrypt.compare` runs, so a nonexistent
email (or an OAuth-only account with a null `passwordHash`) returns in DB-round-trip
time while a real password account pays a full bcrypt verification. Remotely
measurable, and it also flags which accounts are OAuth-only.

Meanwhile `auth.js:70-76` returns a **409** on duplicate registration, handing away the
same information in plaintext on a neighbouring endpoint — so the care taken over the
401s is wasted.

Note `auth.js:70` + `:80` is also a TOCTOU: concurrent registrations race, and the
loser hits P2002 and falls into the generic catch, returning a misleading **500**
instead of the 409.

### F8. `DELETE /auth/account` requires no re-authentication — not scheduled

`auth.js:570-603`. Irreversible, cascades through every Contact / Conversation /
Message / BrandDeal, and requires no password confirmation, no typed-name
confirmation, and no rate limit. The only CSRF protection is `originGuard`, which is
origin-header-based with no token and **passes any request carrying neither `Origin`
nor `Referer`** (`security.js:102`).

The frontend asks for a typed confirmation word, but that is client-side only.

### F9. `GET /auth/instagram` creates a session for every anonymous visitor — not scheduled

`auth.js:209` writes `oauthState` to the session, which initializes it despite
`saveUninitialized: false`. The route is unauthenticated and unthrottled. Against the
MemoryStore that `index.js:161-173` still permits in production, that is a
straightforward memory-exhaustion vector.

Phase 3 moves state out of the session, which removes the cause as a side effect —
but the route should also be rate limited.

### F10. PII in application logs — not scheduled

`auth.js:105` and `:169` log user email on registration and login. `auth.js:592` logs
the email of a user who has just exercised their right to erasure — the log line
outlives the deletion it records, which is GDPR-adverse. `auth.js:295` logs Instagram
usernames.

### F11. Session store silently falls back to MemoryStore in production — not scheduled

`index.js:161-195`: with no `REDIS_URL`, `buildSessionStore()` returns `undefined` and
express-session uses MemoryStore. In production this only **warns**
(`index.js:164-173`). The existing `TODO(post-review)` at `:149-159` documents the
consequence: on a multi-instance deploy users are logged out at random as requests
land on different instances, with unbounded memory growth.

Phase 1 replaces the store with `connect-pg-simple`, which removes the fallback path.
Recorded here because the *warn-instead-of-fail* pattern will still exist for whatever
store is configured.

### F12. Token expiry is tracked but never acted upon — Phase 7

`tokenExpiresAt` is persisted correctly (`auth.js:298`) and the short→long exchange is
performed, but **nothing refreshes it and nothing reacts to it**. No job compares it to
now; nothing marks a token bad on a Meta 401 / code 190.
`tokenStatus: 'EXPIRED'` is documented in the schema but **never written by any code
path**.

At day 60 tokens die silently, `tokenStatus` stays `VALID`, the dashboard shows no
problem, and the first symptom is DMs failing to send.

### F13. Granted OAuth scopes are never compared against required scopes — Phase 3

Instagram Login returns a `permissions` array alongside the token;
`exchangeCodeForToken` returns `response.data` wholesale but only `.access_token` and
`.user_id` are ever read. A user who unticks message permission completes the flow, the
`subscribed_apps` call fails, **the failure is swallowed** (`auth.js:428-431`), and they
land on a dashboard reporting everything as connected while no webhook will ever
arrive.

### F14. Webhook processing after the 200 is not durable — Phase 6

`webhook.js:63` returns 200 before processing, which is correct for Meta. But
everything after it — contact upsert, an **outbound Graph API call** (`:283`),
conversation/message writes, socket emit — runs synchronously on the request
continuation with no retry. Only the AI classification is queued. A crash between the
200 and the message insert silently drops a customer's DM after Meta has been told the
delivery succeeded.

With no `REDIS_URL` the queue is in-process, so queued jobs are also lost on restart.

### F15. `GET /webhook` verify-token comparison is not timing-safe, and has an unset-token bypass — Phase 6

`webhook.js:38` uses plain `===` where the POST path correctly uses
`crypto.timingSafeEqual`. More importantly there is **no boot assertion for
`WEBHOOK_VERIFY_TOKEN`**: if it is unset, `process.env.WEBHOOK_VERIFY_TOKEN` is
`undefined` and a request with no `hub.verify_token` yields `undefined === undefined`
→ true, letting an arbitrary Meta app complete the subscription handshake.

Also `hub.challenge` is echoed unvalidated, so `?hub.challenge=a&hub.challenge=b`
returns JSON instead of the plain-text echo Meta expects.

### F16. Instagram account ownership transfer checks only conversations — Phase 2

`auth.js:326-329` counts `Conversation` rows to decide whether an IG account may move
between workspaces. `Contact` rows hang off `instagramAccountId` and are **not**
checked, so a workspace with contacts but zero conversations hands the new tenant the
usernames, names and profile pictures of everyone who ever DM'd the old one.
`WebhookLog` rows move too and retain message text for up to 30 days.

The count and the update are also not in a transaction, so two concurrent callbacks can
both observe zero.

Phase 2 replaces this logic with the `InstagramIdentity` ledger.

---

## Stale artifacts

### S1. Stale assertion in `scripts/test-socket-isolation.js:421`

Asserts stderr contains
`"FATAL SECURITY MISCONFIGURATION: SKIP_SIGNATURE_VERIFICATION=true is strictly forbidden in production mode"`,
but `index.js:87` actually prints
`"[Server] FATAL: SKIP_SIGNATURE_VERIFICATION=true is forbidden in production. Refusing to start."`

The exit-code assertion passes; the message assertion does not. **This stale string is
most likely the origin of the belief that there were two differently-named signature
bypass flags.** There is only one: `SKIP_SIGNATURE_VERIFICATION`. Being fixed in
Phase 6.

### S2. Dead references to dropped models

Seven call sites outside the test helpers still reference `prisma.subscription` /
`prisma.usageEvent`, which no longer exist:

- `backend/scripts/cleanup-test-data.js:67`, `:96`
- `backend/scripts/e2e-test.js:109`, `:248` (also hits `GET /api/subscription`, now 404)
- `backend/scripts/test-isolation.js:350` (`GET /api/subscription`, now 404)
- `backend/scripts/test-tenant-isolation-e2e.js:422`
- `backend/scripts/verify-cleanup.js:16`

`backend/scripts/audit-prisma-tenant-scope.js:36-37` also still lists `usageEvent` and
`subscription` in its tenant-scope map.

The two in `tests/helpers/db.js` were fixed (pre-commit A) because they broke the whole
suite. These remaining ones are in legacy hand-run scripts that are not part of
`npm test` and not in CI, so they were left alone.

### S3. Stale comments and documentation

- `backend/prisma/schema.prisma:6-7` — header still advertises `usage_events` and
  `subscriptions` as existing tables.
- `backend/tests/helpers/db.js:3` — comment says `resetDb()` "only ever touches
  prisma/test.db"; SQLite-era wording, the DB is Postgres now. Left alone in pre-commit
  A because that commit was scoped to the two broken lines only.
- `backend/vitest.config.mjs` — `fileParallelism: false` comment still says "SQLite is a
  single-writer database". The serialization is still load-bearing (`resetDb()`
  truncates shared tables), only the stated reason is wrong.
- `.env.example:16-17` — still says "SQLite database file... Swap to a Postgres URL in
  production" with `DATABASE_URL=file:./codeback.db`. Copying `.env.example` verbatim
  produces a datasource mismatch against `provider = "postgresql"`.
- `README.md:120` and `CONTEXT.md:102` — both still claim "`BusinessProfile`,
  `CreatorPreference`, and `Subscription` use `upsert`".
- `backend/tests/helpers/app.js` header — line references into `src/index.js` are stale
  (says `:182-198` and `:295-300`; actual are `198-214` and `312-320`).

### S4. `.env.example` drift

Referenced in code but **missing** from `.env.example`:

| Variable | Why it matters |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | 6 references; the entire frontend→backend wiring. Every site defaults to `http://localhost:5000`, so a deploy that misses it builds fine and then cannot reach the API. |
| `NODE_ENV` | Gates all seven fail-fast checks, secure cookies, strict CORS, and the plaintext-admin-password ban. Undocumented, so a deployer gets no prompt to set it. |
| `GROK_API_KEY`, `XAI_API_KEY` | Real providers in the `aiService.js` failover chain. |
| `TEST_DATABASE_URL` | Needed to run the suite off the default port. |
| `SEED_PASSWORD` | Script-only, lowest priority. |

### S5. Vestigial Socket.io `join` handler

`index.js:289-294` validates a client-supplied `userId` and logs a mismatch, but
**never calls `socket.join` in either branch**. Room membership is established once at
`:285` from the server session. The handler is a correct no-op that reads as
functional; the frontend still emits `join` (`dashboard/page.js:107`,
`inbox/page.js:167`).

Harmless, but it invites someone to "fix" it by making it actually join.

### S6. `SKIP_SIGNATURE_VERIFICATION` exposed in the admin settings response

`admin.js:927` returns `skipSignatureVerification` as a camelCase JSON key. Unnecessary
surface. Being removed in Phase 6 unless something is found to consume it.

### S7. Miscellaneous

- **`res.clearCookie('codeback.sid')`** is called with no options at `auth.js:196`,
  `:200`, `:596`, so it does not mirror the `path`/`secure`/`sameSite`/`httpOnly`
  attributes set at `index.js:204-213`. Works today because both default to path `/`;
  breaks silently if the cookie config changes.
- **`req.session.destroy()` without a callback** at `auth.js:480`, with the 401 written
  immediately after and not awaiting the store write.
- **Inconsistent input coercion** — login coerces (`String(password)`), `PUT /profile`
  does not (`:530`, `:538`), turning malformed input into 500s instead of 400s.
- **`PUT /auth/profile` silently ignores an invalid `name`** (`:524`) rather than
  returning 400 — the client gets a 200 and no change.
- **`COOKIE_SAMESITE` is passed through unvalidated** (`index.js:212`). Setting it to
  `none` outside production yields `SameSite=None` without `Secure`, which browsers
  reject outright — silent total session loss.
- **HTTPS cert detection is not gated on `NODE_ENV`** (`index.js:49-63`). If
  `backend/certs/` ever reaches a production image, production terminates TLS with a
  local dev certificate. Relatedly, `cookie.secure` keys off `NODE_ENV`, not the actual
  transport, so the local HTTPS server issues non-Secure cookies.
- **`frontend/AGENTS.md`** contains a block claiming to be auto-written by `next dev`
  that instructs AI agents to read `node_modules/next/dist/docs/` before writing code,
  and states that removing it from a diff re-creates it. Whatever its provenance, a
  tool-writable file that injects instructions into every agent session in this repo is
  an untrusted-input surface worth reviewing deliberately.
