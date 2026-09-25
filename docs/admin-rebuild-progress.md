# Admin rebuild — progress log

Branch: `admin-rebuild` (from `master` 9dfd2f1). **Never push. Never touch master.**
Mode: autonomous (owner instruction). At each gate end: self-review → full backend suite → commit locally → update this file.

## Gate status

| Gate | Status | Commit |
|---|---|---|
| 0 Audit | done (reported in chat) | — |
| 1 Admin login security | done | 3252d6c, e0c13e3 |
| 2 User idle timeout | done | c76745c |
| Trial-claim investigation (read-only) | done — findings below, not fixed | — |
| 3 Health + AI monitoring | done | 4d763ca |
| 3B IG token auto-refresh | done | (see git log: feat(instagram)) |
| 4 Multi-provider AI | pending | |
| 5 User management | pending | |
| 6 Plans, quotas, coupons | pending | |
| 7 Kill switches, settings, alerts, announcements | pending | |
| 8 Hardening + UI polish + final report | pending | |

## Decisions and deviations (owner-approved unless marked NEW)

- Admins are `AdminUser` rows; separate cookie `siffty.admin.sid` and table `admin_sessions`; cookie key derived from SESSION_SECRET.
- Admin activity = mutations + `POST /api/admin/activity` heartbeat (GETs never count).
- Reasons required on every customer/account mutation; step-up also covers CSV exports, log prune, refunds.
- Admin email bucket: 10/day outside the shared 80, 3 reserved for lockouts.
- Impersonation, DM viewer, `DELETE /users/:id`, `DELETE /accounts/:id` removed (delete returns in Gate 5).
- Customer idle: mutations + `POST /auth/activity` only; `user_session_idle_minutes` in `app_settings` (5..1440, default 30); 7-day cap is now absolute; expiry disconnects only that session's sockets; idle socket sweep every 60s (not a JobRun).
- `lastSeenAt` written from activity (≤ once/5 min) — also changes the dashboard "While you were away" window.

### Gate 3 decisions (NEW)
- Existing central wrapper `callAIWithFailover` kept; every provider HTTP attempt (incl. per-model fallback) logs one `ai_call_logs` row. Empty/unparseable answers count as failures (tokens were spent).
- Prices in `backend/src/lib/ai/models.js` are ESTIMATES from list prices at time of writing — UNVERIFIED against current provider pages; health page labels costs as estimates.
- Error ring: captures every `console.error` (+ request route via AsyncLocalStorage), sanitised: first line only, long quoted strings cut, URLs/keys/tokens/emails masked, 240 chars. In memory; restart clears it.
- `job_runs` purged after 30 days (housekeeping). The 60s idle-socket sweep is not recorded (would flood).
- Public `/health` now pings the DB (2s bound) and returns only `{status:"ok"}` or 503 `{status:"error"}` (timestamp removed).
- `POST /api/admin/health/ai-test`: fixed prompt, no customer data, 5/min limit, audit row `AI_TEST`, answers a safe error code only. Not step-up (not destructive).
- Dev scripts in `backend/scripts/` (test-ai-keys etc.) still call providers directly — developer tools, not app paths.

### Gate 3B decisions (NEW)
- Meta endpoint VERIFIED (developers.facebook.com Instagram Platform refresh_access_token, fetched 2026-09-25): GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…; token must be long-lived, >= 24h old, not expired; needs instagram_business_basic; refreshed token valid 60 days; response {access_token, token_type, expires_in}. Matches the existing lib/instagram.js helper.
- Daily job `instagram_token_refresh` (+ at boot): CONNECTED + VALID + expiry in (now, now+10d]. Token age isn't stored; a token within 10 days of a 60-day expiry is >= 50 days old, and the window is also capped at now+59d, so the 24h rule holds.
- Transient failure -> stays VALID, retried daily (up to 10 tries in the window). Meta "dead" (code 190 etc.) -> NEEDS_RECONNECT + the existing one-time customer email.
- New columns on instagram_accounts: token_refreshed_at, token_refresh_failed_at, token_refresh_error (a safe code: META_<n>, HTTP_<n>, NETWORK, BAD_RESPONSE). Migration 20260925150000 (additive).
- flagExpiredTokens() is now SCHEDULED (same daily job, after refresh) rather than replaced — it is what tells the customer about a token that expired anyway.
- Admin failure alert = ONE digest per run to every admin through the admin email bucket, new routine type `adminOpsAlert` (cannot use the 3 lockout-reserved sends). Gate 7 reuses lib/adminAlerts.js.
- The admin "Refresh access" button now uses the same lib/tokenRefresh.js function.
- Local note: `prisma generate` hit EPERM because the owner's dev server holds the engine DLL; the client code generated, and I copied schema.prisma into node_modules/.prisma/client to finish the step. Run a clean `npx prisma generate` next time the dev server is stopped.

## Skipped / TEMP tests

- `admin-session.test.js` H10, `scopes-and-admin.test.js` M10 ×2, `authz-and-limits.test.js` F1/F5 — old admin behaviour, replaced by `admin-auth.test.js`.
- `trial-claim.test.js` "eight concurrent claims…" — PRE-EXISTING failure on master; see investigation below.

## Manual steps for the owner

- Pending approval: `backend/prisma/pending-approval/20260924130000_retire_legacy_admin_users` (apply only after the new admin login is verified in production).
- Env vars to delete after cutover: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH`, `ADMIN_EMAILS`.
- Deploy checklist: `ADMIN.md` → "Production deploy checklist".
- Manual click-through checklist: collected here, reported at the end.

### Manual click-through checklist (accumulating)

- Admin: sign in, every admin page loads, step-up dialog on CSV export, reason dialogs on suspend / refresh / resubscribe / mark-reconnect, change password.
- Admin Health page (`/admin/health`): loads, refreshes every 30s, "Test AI" shows provider/model/latency; an unattended health page still times out after 30 idle minutes.
- Customer idle: with `user_session_idle_minutes = 5`, the warning appears about 3 minutes in; "Stay signed in" in one tab closes the warning in the other; both tabs go to login after 5 minutes.

## Trial-claim race — findings (read-only; NOT fixed, owner decides)

**Is there a real race where one Instagram account gets the trial twice? No.**
Every run, 8 concurrent claims grant exactly one trial, write one ledger row
and stamp one identity. Three things guarantee that:

- the identity stamp is a conditional `UPDATE … WHERE trial_consumed_at IS NULL`,
  and the row lock serialises it;
- `entitlements.user_id` is unique, and a NONE row is only lifted `WHERE status = 'NONE'`;
- `ig_one_active_link` stops two Siffty accounts holding the same IG account at once.

The test's failing line is about the *outcome reported to the losing
requests*, not the grant.

**What actually goes wrong.** I captured the outcomes from 3 runs (2 failed).
Losers sometimes get `TRIAL_ALREADY_CONSUMED` ("this Instagram account already
used its trial") instead of `ALREADY_ENTITLED`. The cause:
`loadUserTrialContext()` reads `entitlements` BEFORE `instagram_identities`, as
separate statements under Postgres READ COMMITTED. A loser can read the
entitlement just before the winner commits (still NONE), then the identity
just after (already stamped). `trialDecision()` then picks "already consumed".
**User impact:** someone who double-clicks "Start trial" (or has two tabs) can
be told their account already used its trial while it *was* just granted. On
refresh they see the active trial. It's confusing at an influencer launch, but
no money or entitlement is wrong.

**Fix (small, ~10 lines + un-skipping the test):**

1. In `loadUserTrialContext()`, read the connected accounts and identity rows
   BEFORE the entitlement. If the identity is seen stamped, the winner's
   transaction has committed (stamp and grant commit together), so the later
   entitlement read sees TRIALING and returns `ALREADY_ENTITLED`.
2. Optional hardening: let `retryOnceIfRaceLost` retry up to 3 times instead
   of once, for bursts of more than two.

The alternative (REPEATABLE READ on the claim transaction) is bigger. It turns
the zero-row conditional updates into serialization errors (P2034) that would
need their own retry handling. Not recommended.

## RESUME HERE

1. Gate 4 — multi-provider AI switching (adapters Gemini/OpenAI/Anthropic via plain fetch/axios, allowlist in lib/ai/models.js, AiConfig table w/ cache, 10 synthetic sample DMs, test/activate (step-up + reason + audit)/rollback, fallback after 5 consecutive failures + email + log, per-call timeout + retries, drop xAI). Mock HTTP in tests.
2. Then Gates 5 → 8.
