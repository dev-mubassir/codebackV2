# Codeback — Deployment Runbook

Branch `auth-hardening`, 19 commits, pushed to origin. Master untouched.

Work top to bottom. Do not skip Phase 0.

---

## PHASE 0 — Blockers

Nothing below this line is safe until all three are cleared.

### 0.1 Run the prod survey

```bash
DATABASE_URL="<northflank-postgres-url>" node backend/scripts/prod-readonly-survey.js
```

Get the connection string from the Northflank dashboard, paste it into your terminal directly. **Not into Claude Code, not into a chat.** A production connection string is a credential like any other — see 2.5 for what to do if one leaks anyway.

Read the verdict line. Three outcomes:

- **History matches the repo** — proceed to 0.2.
- **DRIFTED** — stop. Work through the cleanup in `FINDINGS.md` first: drop orphan tables *before* clearing phantom `_prisma_migrations` rows, and snapshot the Northflank database before touching that table. There is no undo on a bad DELETE there.
- **Tables missing entirely** — migrations were never applied to prod. Different situation, simpler. Tell Claude Code and it'll adjust.

### 0.2 Count null-email users on prod

```sql
SELECT COUNT(*) FROM users WHERE email IS NULL;
```

- **Zero** — proceed.
- **Not zero** — do not deploy. This release forces those accounts to an "add your email" step that has no UI. They'd be locked out with no path forward. The add-email endpoint exists and is tested; only the UI is missing.

### 0.3 Domain — resolved

**Production is `siffty.com`. `citykirana.in` is the local tunnel domain (cloudflared), used for local Instagram OAuth and webhook testing only.** This is settled, not a decision to make at deploy time — but three things depend on getting it right, so confirm each before touching Northflank:

1. **Google Cloud Console** — the OAuth client currently has `https://api.citykirana.in/auth/google/callback` registered (from local testing) but not the production one. Add `https://api.siffty.com/auth/google/callback` as an additional redirect URI. **Add, don't replace** — keep the citykirana one for local dev. You're handling this yourself; Claude Code has no Google Console access.
2. **Meta dashboard** (Phase 7) — use the siffty URLs, not citykirana.
3. **Env vars** — `FRONTEND_URL` must be `https://app.siffty.com` and `BACKEND_URL` must be `https://api.siffty.com`.
   - Note the variable name is `FRONTEND_URL`, **not `APP_BASE_URL`** — that name doesn't exist anywhere in this codebase. `FRONTEND_URL` is what `frontendUrl()` in [routes/auth.js](../backend/src/routes/auth.js) actually reads to build every password-reset, verification, and OAuth-redirect link. Setting `APP_BASE_URL` in Northflank would silently do nothing — the app would keep using `FRONTEND_URL`'s `localhost:3000` default.
   - `BACKEND_URL` matters beyond CORS now: [google.js](../backend/src/lib/google.js) derives the Google OAuth redirect URI directly from it (`${BACKEND_URL}/auth/google/callback`) — there is deliberately no separate `GOOGLE_REDIRECT_URI` env var, so this is the one place to get it right.
   - Both are now enforced at boot — see Phase 3.

### 0.4 Phone tests on local

`TESTING.md` items 1–4. All four now unblocked since email works.

1. Mobile Instagram OAuth — start connect on your phone, let it bounce through the Instagram in-app browser to your default browser. This structurally could not work before the signed state token.
2. Deauthorize callback — connect, then remove the app from Instagram's settings. Never seen a real Meta payload.
3. Real DM — send one, confirm it arrives, is classified, and doesn't double-process on retry.
4. Reconnect after disconnect — same account, same user. Must work, must not grant a second trial.

Anything broken gets fixed on `auth-hardening` and pushed before the merge.

---

## PHASE 1 — Merge to master

```bash
git checkout master
git pull origin master
git merge --no-ff auth-hardening
```

`--no-ff` keeps the 19 commits as an identifiable block, which makes reverting the whole release one command instead of nineteen.

If there are conflicts, they'll be in the two citykirana files. Resolve, don't force.

```bash
git log --oneline -5
git push origin master
```

**Never force-push master.** If something's wrong, fix forward or revert the merge commit.

Note the merge commit SHA. You need it for rollback.

---

## PHASE 2 — Northflank environment variables

### 2.1 Get the authoritative list

Read `DEPLOYMENT.md` — it lists every new variable, what it's for, and required vs optional. Ask Claude Code:

```
Read DEPLOYMENT.md and produce a deployment checklist for Northflank:
1. Every env var this release ADDS, split into required and optional
2. Every var whose meaning or default CHANGED
3. Which belong in the build-time secret group vs runtime — NEXT_PUBLIC_*
   must be build-time or Next.js won't inject them during the build
4. Which are backend-only vs frontend
5. For each: exact value, or how to generate it, or "copy from local .env"
Then check what the running Northflank services already have set (via CLI
if available) and produce a diff — what's missing, what's stale.
Do not set anything. Output only.
```

### 2.2 Variables you already know are needed

Cross-check against the generated list:

| Variable | Source |
|---|---|
| `RESEND_API_KEY` | Resend dashboard |
| `FROM_EMAIL` | `noreply@mail.siffty.com` |
| `SUPPORT_EMAIL` | `support@siffty.com` |
| `REPLY_TO_EMAIL` | `support@siffty.com` — **not `REPLY_TO`**, that name does nothing; the code reads `REPLY_TO_EMAIL` ([email/index.js](../backend/src/lib/email/index.js)) and falls back to `SUPPORT_EMAIL` if unset |
| `GOOGLE_CLIENT_ID` | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console |
| `OAUTH_STATE_SECRET` | generate fresh for prod (base64, 32 bytes) |
| `IG_IDENTITY_PEPPER` | **generate fresh, back it up permanently** |
| `TOKEN_ENCRYPTION_KEY` | already set on prod — do not change |
| `EMAIL_DAILY_CAP` | `80` |
| `EMAIL_CRITICAL_RESERVE` | `20` |
| `FRONTEND_URL` | `https://app.siffty.com` — see 0.3; **not `APP_BASE_URL`** |
| `BACKEND_URL` | `https://api.siffty.com` — see 0.3 |
| `NEXT_PUBLIC_BACKEND_URL` | `https://api.siffty.com` — **build-time**, see 2.3 |
| `WEBHOOK_VERIFY_TOKEN` | rotate before prod as hygiene, not urgency — see 2.4 |

**`IG_IDENTITY_PEPPER` is the one that can never be rotated.** Lose it and every entry in the trial-abuse ledger becomes unmatchable — every past trial user gets a fresh trial. Store it somewhere that survives a laptop dying, before you use it.

**Do not reuse dev secrets on prod** for `OAUTH_STATE_SECRET` or `IG_IDENTITY_PEPPER`. `TOKEN_ENCRYPTION_KEY` is the exception — prod already has one and changing it orphans every stored Instagram token.

### 2.3 Set them in Northflank

Secret groups, never plaintext in service env vars. Two things that have bitten you before:

- A secret group must be linked to a service **after** the service exists. Groups created beforehand have empty allow-lists and inject nothing.
- `NEXT_PUBLIC_*` goes in a **build-time** group. `next build` inlines `NEXT_PUBLIC_*` values directly into the static JS bundle at build time — there is no runtime step where a missing one can still be fixed. A runtime-only secret group injects nothing during the build, and the frontend ships with whatever was (or wasn't) present when `next build` ran.

`NEXT_PUBLIC_BACKEND_URL` specifically is now enforced: [frontend/src/lib/backendUrl.js](../frontend/src/lib/backendUrl.js) throws and fails `next build` outright if the value is unset or still a `localhost`/`127.0.0.1` address while `NODE_ENV=production`. Every place that used to read `NEXT_PUBLIC_BACKEND_URL` with its own inline `|| 'http://localhost:5000'` fallback (`next.config.mjs`, `lib/api.js`, and four page files) now imports the value from that one module instead — so a future file can't quietly reintroduce a seventh independent default. If the Northflank build fails with an error naming `NEXT_PUBLIC_BACKEND_URL`, that's this guard doing its job — check that the secret group is actually linked as build-time, not just present in a runtime group.

### 2.4 Credential hygiene

- **`WEBHOOK_VERIFY_TOKEN` — downgraded from "leak" to "hygiene."** [mubassirrr2005/codebackV2](https://github.com/mubassirrr2005/codebackV2) is a **private** repository, and the value tracked in `.env.example` (`codeback_webhook_verify_123`) is an obvious placeholder, not a real credential. `backend/local.env` — the file that actually holds production-shaped secrets — was never committed to git history; it was untracked all along, and the `.gitignore` entry added on this branch closed the gap before it could be. So there is no real exposure here. Still rotate `WEBHOOK_VERIFY_TOKEN` before prod, because a tracked file is the wrong place for the value that ends up live — just not urgently, and not as an incident.
- The Resend API key and Google client secret — rotate if either was ever pasted into a chat.
- Any credential pasted into a chat (see 0.1's warning) — rotate using 2.5 below, don't just swap the value in Northflank and hope.

### 2.5 Rotating a credential without an outage

Any live-service credential rotation — `DATABASE_URL`, `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`, `WEBHOOK_VERIFY_TOKEN` — follows the same two-phase shape. **Finalizing before the running service has actually picked up the new value breaks production**, because the old credential can stop working at the provider the moment you revoke it there, regardless of what Northflank has cached in memory.

1. **Start the rotation at the provider** (Northflank Postgres, Resend, Google Cloud Console, Meta). Most providers issue a new credential alongside the old one, which keeps working until you explicitly revoke it — confirm that's true for the specific provider before relying on it. Postgres password rotation in particular sometimes invalidates the old value immediately; if so, there's no overlap window and steps 2–3 need to happen fast, with the service expected to be briefly unable to connect until step 2 completes.
2. **Update the Northflank secret group** with the new value, then **redeploy or restart** the affected service. Northflank does not hot-reload env vars into a running container — the process has the old value in its own environment until it restarts.
3. **Verify the service is actually using the new credential** before touching the old one:
   - `DATABASE_URL` — confirm the boot log shows a successful Postgres session-store connection, then hit `/health`.
   - `RESEND_API_KEY` — send one real test email and confirm it arrives.
   - `GOOGLE_CLIENT_SECRET` — run one real Google login end to end.
   - `WEBHOOK_VERIFY_TOKEN` — trigger the Meta webhook handshake and confirm it 200s.
4. **Only then finalize** — revoke or delete the old credential at the provider. Revoking before step 3 passes, with the new value turning out to be wrong, leaves the service with no working credential in either slot.

---

## PHASE 3 — Deploy

Trigger a manual deploy from the Northflank dashboard. CI stays disabled.

Backend first, then frontend. If the backend fails to boot, the frontend has nothing to talk to.

**Watch the boot logs.** This release adds fail-fast checks — a missing or wrong required variable now kills the process at startup and names itself, rather than failing silently or late:

- `TOKEN_ENCRYPTION_KEY`, `OAUTH_STATE_SECRET`, `IG_IDENTITY_PEPPER` — fatal if unset (documented in `DEPLOYMENT.md`).
- **New in this pass:** `FRONTEND_URL` and `BACKEND_URL` are each fatal in production if unset **or still pointing at `localhost`/`127.0.0.1`/`local.codeback.test`** ([backend/src/index.js](../backend/src/index.js), next to the pre-existing `looksPublic` warning that catches the opposite case — a public URL while `NODE_ENV` isn't `production`). This closes the exact failure mode a wrong env var *name* would also have caused: the server boots "successfully" and then quietly builds password-reset, verification, and OAuth-redirect links that only resolve on the machine running the process. The two checks are separate so a deploy missing only one of them gets an unambiguous, individually-named error instead of one combined message.

If it dies, the log tells you which variable. Do not proceed to Phase 4 until both services are healthy.

---

## PHASE 4 — Run the migration

Manually, in the service shell. Never on container start, never via `npx`:

```bash
./node_modules/.bin/prisma migrate deploy
```

This migration is self-defending — preconditions abort the whole transaction rather than applying partially, and they name the offending rows. If it aborts, read the message; it tells you exactly what's wrong.

The one that can genuinely fail: two `CONNECTED` rows for the same `ig_user_id`. Prod survey should have caught it, but the guard is there regardless.

Afterwards, verify:

- `ig_one_active_link` exists
- the six token columns exist
- `webhook_deliveries` exists
- the six new tables are present

**Session table.** The store changed from MemoryStore to Postgres. Confirm the session table exists — if `connect-pg-simple` isn't configured with `createTableIfMissing`, it has to be created manually or every login fails. Verify before declaring success.

---

## PHASE 5 — Post-migration backfills

Two scripts, run in this order. Neither is part of the migration, by design.

### 5.1 Email verification grandfathering

```bash
node backend/scripts/backfill-email-verified.js
```

Behind a confirmation flag. It prints the affected users first. **Read that list before confirming.** If anything in it is a real customer rather than a test account, stop.

### 5.2 Token encryption — stage 2

```bash
node backend/scripts/backfill-token-encryption.js
```

Encrypts any remaining plaintext Instagram tokens. Then verify by decryption, not by a non-null check — decrypt every row from the new columns and confirm zero failures.

**Stage 3 does not happen in this release.** The `crypto.js` plaintext passthrough and the `access_token` column both stay. Removing them requires this backfill verified complete in every environment, and this is the first time prod has been touched. That's `FINDINGS.md` D3.

---

## PHASE 6 — Verify production

In order, stopping at the first failure:

1. **Boot** — both services healthy, no fail-fast errors.
2. **Register** a new test account on prod. Verification email arrives.
3. **Verify** via the emailed link.
4. **Forgot password** → email arrives → reset works → old password rejected → old session evicted.
5. **Google login** — the redirect URI registered in 0.3 lands here. A mismatch fails immediately and visibly.
6. **Connect Instagram** — trial granted, 3 days, `TRIALING`.
7. **Webhook** — send a real DM, confirm it arrives and is classified.
8. **Data deletion** — hit the status endpoint, confirm it responds.

Then check the Resend dashboard: sends went out, nothing bounced, quota counter moving as expected.

---

## PHASE 7 — Meta dashboard

Only after Phase 6 passes.

Register both, using the siffty domain (see 0.3):

- **Data Deletion Request URL** — `https://api.siffty.com/data-deletion/instagram`
- **Deauthorize Callback URL** — `https://api.siffty.com/data-deletion/deauthorize`

The deauthorize URL is new and has never been registered.

**One warning:** the data-deletion endpoint verifies Meta's HMAC with no development bypass — strict in every environment. If `INSTAGRAM_APP_SECRET` on prod doesn't match the app you register these under, it returns 400 and deletes nothing. Meta tests this during review. Confirm it works before submitting.

Also before submission:

- Fold `PRIVACY_NOTES.md` into your published privacy policy. The abuse ledger survives deletion requests and has to be disclosed.
- Confirm the webhook callback URL still points at the right host.
- Settle the app name / support email / URL domain coherence problem.

---

## ROLLBACK

**If the deploy fails before the migration ran:** redeploy the previous build in Northflank. Nothing to undo.

**If the migration ran and something's wrong:** harder, and why the `--no-ff` merge matters.

- The migration drops a unique index and adds columns. Rolling the *code* back to a build that expects the old schema mostly works, since the new columns are additive and nullable — but the dropped global unique on `igUserId` does not come back on its own.
- If you need the code reverted: `git revert -m 1 <merge-commit-sha>`, push, redeploy. Do not force-push.
- The database does not roll back with it. If schema state is genuinely wrong, restore the Northflank snapshot you took in 0.1.

**Take that snapshot.** It's the only real undo in this runbook.

---

## Order summary

```
0. Prod survey → null-email count → domain confirmed (siffty.com) → phone tests
1. Merge auth-hardening → master (--no-ff), push
2. Set Northflank secrets (build-time group for NEXT_PUBLIC_*), rotate
   WEBHOOK_VERIFY_TOKEN, dual-phase any credential rotation (2.5)
3. Deploy backend, then frontend — watch for the new FRONTEND_URL/BACKEND_URL
   boot assertions and the NEXT_PUBLIC_BACKEND_URL build guard
4. prisma migrate deploy in the shell, verify schema + session table
5. Backfill email verification, then token encryption
6. Verify prod end to end
7. Register Meta URLs (siffty domain), publish privacy policy
```
