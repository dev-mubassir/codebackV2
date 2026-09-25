# Siffty super-admin panel

> Admin rebuild, final (Gate 8). Covers sign-in, creating and resetting
> admins, environment variables, AI provider keys, kill switches and alerts,
> the uptime monitor, the privacy-policy reminder and the deploy checklist.

The admin panel lives at `/admin` on the app domain. Its API is `/api/admin/*`
on the API domain. Admins are **not** Siffty customers: they are rows in the
`admin_users` table, created only by the owner-run scripts below. No HTTP route
creates an admin, there is no signup, and Google sign-in never grants admin.

## How admin sign-in works

- Sign in with email and password only.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes. Wrong
  passwords typed into the step-up dialog count toward the same 5. A lockout
  also signs out every session of that admin.
- **Rate limit:** a separate limit of 10 attempts per 15 minutes per IP.
- **No enumeration:** every failure (unknown email, wrong password, locked)
  gives the same answer.
- **Alert emails:** every successful sign-in, and every lockout, emails the
  admin's own address with the time, IP and browser. These alerts have their
  own quota of 10 per day, separate from customer mail.
- **Separate session:**
  - The cookie is `siffty.admin.sid`: HttpOnly, Secure in production,
    SameSite=Strict, Path=`/api/admin`.
  - It is stored in its own table (`admin_sessions`).
  - It ends after **30 minutes without activity**, or **8 hours after sign-in**,
    whichever comes first.
  - Activity means a real click, keystroke or page change in the panel.
    Background refreshes do not count.
- **Step-up:** anything destructive or security-relevant asks for your password
  again: CSV exports, clearing delivery logs, refunds, deleting a customer,
  activating an AI model, plan edits and per-customer plan controls, and the
  kill switches / session timeout. It stays confirmed for 5 minutes.
- **Reasons:** every action that changes a customer or the system asks for a
  written reason (3-500 characters).
  The reason goes into the audit log (`admin_audit_logs`), which records every
  sign-in attempt and every change.
- **Not an admin:** anyone who isn't a signed-in admin, including a signed-in
  customer, gets a plain `404` from every admin API route.
- **CSRF:** every admin mutation must carry an allowlisted `Origin` header
  (the app's own URL). A missing or foreign Origin is refused, even with a
  valid session.
- **Headers:** admin API answers are `no-store` and `noindex`; admin pages are
  `noindex`, cannot be framed and send no referrer. Nothing in the customer
  app links to `/admin`.
- **Privacy:** the panel never shows Instagram DM content: counts and
  metadata only.

## Create the first admin (production)

You run this yourself, **interactively**, in a shell on the running production
backend. This is the same Northflank **service shell** the deployment runbook
uses for `prisma migrate deploy` (see `docs/DEPLOYMENT-RUNBOOK.md`, Phase 4).
`DATABASE_URL` is already set in that shell's environment. The script reads it
and **never prints it**; any error text is scrubbed of connection strings.

1. The migrations must already be applied (deploy checklist step 2, run
   from your machine with `scripts/prod-migrate.ps1` BEFORE the code is
   pushed). Otherwise the new backend refuses to start (the migration guard).
2. In the new container's service shell:
   ```bash
   node scripts/create-admin.js
   ```
3. Type the admin email. The password is asked twice, **hidden**, and must be
   at least 16 characters. Nothing is echoed or saved to shell history.
4. Sign in at `https://app.siffty.com/admin/login`.

The script needs a real terminal, because the password is read with echo off.
Do **not** run it as a Northflank job or with the password in an environment
variable or command argument. Both would leave the password readable in the
dashboard, the job logs or the process list.

Locally it is the same command from `backend/`, and it uses `backend/.env`.

## Reset a lost admin password

Also owner-run, in the same service shell:

```bash
node scripts/reset-admin-password.js
```

It asks for the email and a new password (hidden, twice, at least 16
characters). It also clears any lockout and **signs out every session of that
admin**.

## Change your own password

Go to Admin → Settings → "Change your password". It needs your current
password. The session you use stays signed in; every other session of your
admin account is signed out.

## Environment variables

The admin panel needs **no** environment variables of its own. Related ones:

| Variable | Needed? | What it does |
|---|---|---|
| `GEMINI_API_KEY` | yes (today's provider) | Google Gemini, the default AI provider. |
| `OPENAI_API_KEY` | optional | Makes OpenAI selectable on the AI page. |
| `ANTHROPIC_API_KEY` | optional | Makes Anthropic (Claude) selectable on the AI page. |
| `BILLING_ENABLED` | existing | `true` = subscriptions enforced. The admin "Enforce subscriptions" switch overrides it at runtime; reset the switch to follow the variable again. |
| `RESEND_API_KEY`, `EMAIL_FROM` | existing | Admin sign-in/lockout emails and ops alerts use the same sender. |

A provider without a key shows as **not configured** and cannot be selected.

> **Side effect to know about:** the admin cookie's signing key is derived from
> `SESSION_SECRET`. Rotating `SESSION_SECRET` therefore signs out **every admin
> session**, as well as every customer session. That is harmless (sign in
> again), but expect it. `SESSION_SECRET_PREVIOUS` keeps *customer* cookies
> valid across a rotation; it does **not** do the same for admin cookies.

These old variables are **no longer read**. Delete them from Northflank; the
server logs a warning at boot while any of them is still set:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_EMAILS`
- `AI_PROVIDER`, `GROK_API_KEY`, `XAI_API_KEY` (the AI provider is chosen in
  the panel now; xAI was removed)

## Add a new AI provider key

1. In Northflank, add `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to the backend
   service's secrets and redeploy. Keys are only read from the environment,
   never stored in the database or shown in the panel.
2. **First** add that provider to the privacy policy (see below).
3. Admin > AI provider: the provider is now selectable. Pick a model and run
   "Test on 10 sample messages" (synthetic messages, no customer data).
4. If the test passes, Activate (reason + password). Roll back is one click.

Adding a provider other than OpenAI, Anthropic or Gemini is a code change:
an adapter in `backend/src/lib/ai/adapters.js` and its models and prices in
`backend/src/lib/ai/models.js`.

## Privacy-policy reminder for AI providers

DM text is sent to whichever AI provider is active. Before activating OpenAI
or Anthropic in production, list that provider as a sub-processor in the
privacy policy (`frontend/src/app/privacy`), with what is sent (message text
and business profile facts) and why (classification and reply drafts). The AI
page shows the same reminder.

## Kill switches, alerts, announcements

Admin > **Kill switches & alerts** (`/admin/controls`). Changes apply within
30 seconds; every change is audited.

- **AI classification** off: new DMs are still received and shown, but not sent
  to any AI provider and get no auto-reply. Turning it back on re-queues the
  last 24 hours.
- **New signups** off: email and Google signups are refused; existing
  customers sign in normally.
- **Maintenance mode** on: customers see "Siffty is being updated". Meta
  webhooks, the Cashfree webhook, data-deletion callbacks, `/health`, jobs and
  this panel keep working, so no DM is lost.
- **Enforce subscriptions**: follows `BILLING_ENABLED` until changed here.
- **Customer idle sign-out**: 5-1440 minutes (default 30).
- **Alert thresholds**: checked every 5 minutes; an email goes to every admin
  at most once an hour per alert type (AI error rate, daily AI cost, one
  customer's usage spike, no Meta webhooks, slow database, failed job, AI
  fallback).

Admin > **Announcements**: a banner at the top of the customer app for the time
window you choose. Admin > **Business metrics**: signups, DMs, active
customers, trial-to-paid, connected accounts.

## Free uptime monitor on /health

`GET <your API domain>/health` returns `200 {"status":"ok"}` when the server
and database answer, and `503` otherwise. It reveals nothing else.

1. Create a free account at an uptime service (for example UptimeRobot or
   Better Stack; both have free plans with 5-minute checks).
2. Add an HTTP(S) monitor for `https://<your API domain>/health`, interval
   5 minutes, alerting on any status other than 200 (optionally also check
   that the body contains `"ok"`).
3. Set the alert contact to your admin email.

The in-panel alerts cannot tell you the server is down (the server sends
them); this monitor can.

## Legacy admin rows in `users`

The old panel could make a *customer* row an admin (`users.role = 'ADMIN'`),
and it created a fake `admin@codeback.internal` customer. Those rows grant
nothing now. To see them, as ids and emails only (read-only):

```bash
node scripts/list-legacy-admin-users.js
```

The cleanup migration waits for approval in
`backend/prisma/pending-approval/20260924130000_retire_legacy_admin_users/`.
It copies their old audit history into `admin_audit_logs`, demotes them to
`USER`, and suspends the fake row. It deletes nothing.

## Production deploy checklist for the admin rebuild

Follow the steps in this order. Each step says what to check before you move
on, and how to back out. Steps marked **(owner)** are yours alone: they touch
the production database or its credentials.

| # | Step | Who |
|---|---|---|
| 1 | Back up the database | owner |
| 2 | Apply the migrations (old code still running) | owner |
| 3 | Push `master` (deploy the code) | Claude, after you paste the migrate status |
| 4 | Check `/health` and the boot log | owner |
| 5 | Create the admin | owner |
| 6 | Verify admin sign-in | owner |
| 7 | List the legacy admin rows | owner |
| 8 | Promote the legacy cleanup migration | Claude, after you paste the list |
| 9 | Apply it (migrate again) | owner |
| 10 | Delete the old environment variables | owner |
| 11 | Set up the uptime monitor | owner |

Keep the old `ADMIN_*` variables in Northflank until step 10. The **old** code
needs them for admin sign-in, so keeping them is what makes rolling back the
code (step 3) safe.

### Step 1: Back up the database (owner)

In the Northflank dashboard: project `codeback` > Addons > `codeback-postgres`
> Backups > take a manual backup. Wait until it shows as completed.

**Rollback for everything below, as a last resort:** restore this backup.

### Step 2: Apply the migrations (owner, old code still running)

The rebuild adds eight migrations. They apply in this order, and all are
safe while the old code runs: the old code never reads the new tables or
columns, and the migration guard only refuses to start when the database is
*behind* the code, never ahead.

| Migration | What it does | Writes data? |
|---|---|---|
| `20260924120000_admin_users_audit_sessions` | admin_users, admin_audit_logs, admin_sessions | no |
| `20260925090000_app_settings` | app_settings (kill switches, thresholds) | no |
| `20260925120000_ai_logs_job_runs` | ai_call_logs, ai_usage_daily, job_runs | no |
| `20260925150000_token_refresh_tracking` | 3 nullable columns on instagram_accounts | no |
| `20260925180000_ai_config` | ai_config (empty = today's Gemini model) | no |
| `20260926090000_plan_terms_coupons` | plan features, entitlement term-snapshot columns, coupons | **yes**: copies each entitlement's current plan limits into the new term columns. The old code never reads them. |
| `20260926091000_trial_plan_credits` | TRIAL plan row | **yes**: 0 to 25 reply credits, only if still 0. The old code grants 25 hardcoded anyway; only the trial summary's displayed number changes, to the true value. |
| `20260926120000_announcements` | announcements | no |

How, from this checkout (Windows PowerShell):

1. Window 1, the port-forward (keep it open):
   ```powershell
   northflank forward addon --projectId codeback --addonId codeback-postgres --skipHostnames
   ```
   Note the local address it prints for Postgres (IP and port).
2. Dashboard: `codeback-postgres` > **Connection details**. Copy the
   `POSTGRES_URI` value (the internal connection string). Paste it somewhere
   **only in your head / a text box you won't save**: replace the part between
   `@` and the next `/` (the internal `host:port`) with the forwarded address
   from step 1. Keep the user, password, database name and any `?sslmode=...`
   unchanged.
3. Window 2:
   ```powershell
   cd C:\codeback\backend
   powershell -ExecutionPolicy Bypass -File .\scripts\prod-migrate.ps1
   ```
   Paste the edited connection string at the hidden prompt, type `MIGRATE`.
   It runs `prisma migrate deploy` then `prisma migrate status` and clears the
   variable.

**Check:** `migrate status` says the database schema is up to date, with no
pending or failed migrations. Paste that output to Claude.

**Rollback:** only needed if the new code is never deployed. Each migration
file has a REVERSE block at the top; run them newest first, then remove their
`_prisma_migrations` rows. Leaving them in place is harmless to the old code.

### Step 3: Push master (deploy the code)

`admin-rebuild` is already merged into local `master`; Claude pushes it after
checking your migrate status output. Northflank builds and deploys it.

**Rollback:** a revert commit of the merge on `master`, pushed (never a
force-push). The old code comes back with its old admin sign-in, because the
`ADMIN_*` variables are still set. The new tables stay behind, unused.

### Step 4: Check /health and the boot log (owner)

- [ ] `GET https://<api domain>/health` returns 200 `{"status":"ok"}`.
- [ ] The boot log has no migration-guard error and no crash loop.
- [ ] The boot log warns that the `ADMIN_*` (and `AI_PROVIDER` / `GROK_API_KEY`
      / `XAI_API_KEY`, if set) variables are set but unused. Expected until
      step 10.

### Step 5: Create the admin (owner)

In the new container's service shell:

```bash
node scripts/create-admin.js
```

Type your email and a password of at least 16 characters (hidden, asked
twice).

**Rollback:** nothing to undo for the system. To redo it, use
`reset-admin-password.js`. To remove the admin, delete its `admin_users` row;
its audit rows stay, with `admin_id` set to NULL.

### Step 6: Verify admin sign-in (owner)

- [ ] Sign in at `/admin/login`. The alert email arrives with the time, IP and
      browser.
- [ ] Every admin page loads: dashboard, health, AI provider, users, plans,
      coupons, payments, accounts, support, business metrics, kill switches &
      alerts, announcements, settings.
- [ ] A step-up action (for example the users CSV export) asks for your
      password, then works.
- [ ] In a private window, signed in as a normal customer, `/api/admin/me`
      returns 404.
- [ ] Settings > Change your password works. Then sign in again with the new
      password.

**Rollback:** if sign-in does not work, do not continue. Check the logs. If it
cannot be fixed quickly, roll back as in step 3.

### Step 7: List the legacy admin rows (owner)

This script only exists in the NEW container. In its service shell:

```bash
node scripts/list-legacy-admin-users.js
```

**Save the output.** It is the record step 9's rollback restores from. Paste
it to Claude.

### Step 8: Promote the legacy cleanup migration

Claude moves `prisma/pending-approval/20260924130000_retire_legacy_admin_users`
into `prisma/migrations`, runs the tests, commits and pushes. Wait for the
deploy to finish.

### Step 9: Apply it (owner, migrate again)

Same as step 2: port-forward, then `.\scripts\prod-migrate.ps1`.

**Check:** `node scripts/list-legacy-admin-users.js` in the service shell
shows the rows with `role=USER`, and the fake row is suspended.
`admin_audit_logs` now has `LEGACY_*` rows.

**Rollback:** using the list you saved in step 7, set `role = 'ADMIN'` on
those ids, and set `is_suspended = false` on `admin@codeback.internal`.
Delete the copied history with:
`DELETE FROM "admin_audit_logs" WHERE "action" LIKE 'LEGACY_%';`

### Step 10: Delete the old variables (owner)

In Northflank, delete `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
`ADMIN_PASSWORD_HASH`, `ADMIN_EMAILS`, `AI_PROVIDER`, `GROK_API_KEY` and
`XAI_API_KEY`, then redeploy.

**Check:** the boot log no longer warns about them.

**Rollback:** re-add them. You only need them if you ever roll back to code
from before the admin rebuild.

### Step 11: Set up the uptime monitor (owner)

See "Free uptime monitor on /health" above.
