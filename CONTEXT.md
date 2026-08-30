# Codeback Project Context & Architecture Guide

## 1. Product Overview & Core Architecture
Codeback is a generalized AI-powered Instagram DM Customer Intelligence, Lead Qualification, Sales & Support SaaS.
The platform serves **any Instagram business or creator**:
- Video & Photo Editors
- Product Sellers
- Used Phone & Laptop Sellers
- Clothing & Fashion Boutiques
- Freelancers & Solopreneurs
- Agencies & Studios
- Coaches & Consultants
- Content Creators & Influencers

---

## 2. Real-Time Chat & Smart Folder Architecture

### Live Chat Stream (`handleNewMessage`)
- Uses `selectedConvRef` to track the currently open conversation ID without stale closures or state batching delays.
- When an incoming message arrives via Socket.io:
  - If the conversation is currently selected/open: appends the message immediately to the message stream in real time and automatically scrolls to the bottom.
  - Updates the conversation's preview and timestamp, automatically sorting it to the top.
  - Dynamically updates the 24-hour messaging window to `{ status: 'open', canReply: true, hoursRemaining: 24 }`.

### Live Smart Folder Counters & Classification Logic
- `matchesFolder(conv, folderId)` classifies conversations cleanly across all folders:
  - `🔥 Hot Leads`: Matches `hot_lead` category, high purchase intent (`>= 80%`), or hot lead customer type.
  - `🎯 Leads & Inquiries`: Aggregates all commercial inquiries (services, products, pricing, turnaround, delivery, and leads).
  - `💰 Customers`: Verified past buyers and returning customers.
  - `❓ Questions`: General product/service and FAQ inquiries.
  - `🎧 Support`: After-sales support requests and delivery follow-ups.
  - `👤 Needs Human`: Inquiries flagged for manual creator negotiation or when auto-reply limits are reached.
  - `🚫 Spam & Scams`: Filtered spam bots, phishing attempts, and abusive messages.
  - `● Unread`: Any conversation with `unread: true`.
  - `🔥 Important`: Critical/high priority conversations or priorityScore `>= 70`.
- All sidebar folder counts update instantly in real time via Socket.io without page reload.

---

## 3. Multi-Tenant Security & Data Isolation

### Hard Tenant Isolation Rules
1. **Server-Side Session Ownership**: Every query touching tenant data must be filtered by authenticated user ownership (`instagramAccount: { userId: req.userId }`).
2. **Socket.io Handshake Session Authentication**: `express-session` middleware is mounted on `io.engine.use(sessionMiddleware)`. Sockets are authenticated via `socket.request.session.userId` and auto-joined to `user:${userId}` on connection. Unauthenticated sockets are immediately rejected with `socket.disconnect(true)`.
3. **Socket Disconnection on Logout**: Calling `POST /auth/logout` or `DELETE /auth/account` triggers `disconnectUserSockets(userId)`, terminating all active sockets for that user room.
4. **Disconnected Account Webhook Safety**: Webhooks for accounts with `connectionStatus === 'DISCONNECTED'` are skipped and logged as `skipped_disconnected` in `WebhookLog`.
5. **Account Re-Link Refusal on Conversation History**: In `GET /auth/instagram/callback`, attaching an Instagram account to a `userId` other than its current owner is refused with `409 Conflict` when the account holds **any** `Conversation` rows, and audit-logged as `ACCOUNT_RELINK_BLOCKED`. The response names neither workspace. Accounts with zero conversations may transfer, logged as `ACCOUNT_RELINK_TRANSFERRED`.
   The previous rule counted `BrandDeal` rows only, so an account with thousands of DMs and no sponsorship deal transferred silently — moving every contact, conversation, message, and analysis to another tenant.
6. **OAuth `state` (CSRF)**: `GET /auth/instagram` mints a 32-byte `state`, stores it on the session, and the callback verifies it with `crypto.timingSafeEqual` **before** exchanging the code with Meta. The stored value is consumed unconditionally (no replay) and expires after 10 minutes. The bare-root shim in `index.js` forwards `state` as well as `code`, or the check could never pass.
7. **No Mock-OAuth Backdoor**: `lib/instagram.js` previously short-circuited four functions on `test_code_` / `mock_short_token_` / `mock_long_token_` prefixes whenever `NODE_ENV !== 'production'`, minting a token and profile for an arbitrary Instagram user id with no call to Meta. Removed outright — **not** behind a flag. A control whose correctness depends on an env var being right on every future deploy is not a control.
8. **Session Regeneration on Privilege Transitions**: `lib/session.js` `startAuthenticatedSession()` regenerates the session id on login, registration, OAuth completion, and admin elevation. Admin elevation explicitly carries an existing regular-user session across the regeneration, preserving the "admin login must not overwrite a regular user session" invariant.
9. **Production Signature Verification Gate**: `SKIP_SIGNATURE_VERIFICATION` is strictly gated by `!isProduction`. In production mode (`NODE_ENV=production`), the backend crashes with a fatal error on boot if `SKIP_SIGNATURE_VERIFICATION=true` is set.

### Application Security Hardening
Additional platform hardening across auth, session, transport, and admin surfaces (`backend/src/lib/security.js`, `backend/src/lib/rateLimit.js`):

1. **Session-only identity (no query-param auth)**: `requireAuth` and `/auth/*` derive identity **exclusively** from `req.session.userId`. A previous `?user_id=` debug fallback that let any request act as any account by id has been removed everywhere.
2. **Admin credentials from environment only, hashed in production**: `POST /api/admin/login` has **no hardcoded default**. Production requires `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` (bcrypt); plaintext `ADMIN_PASSWORD` is ignored at runtime and the server **refuses to boot** if it is set while `NODE_ENV=production`. Constant-time comparison, rate-limited, `503` when unconfigured. First-user auto-promotion to `ADMIN` was removed.
   This is weighted above a normal credential because an admin session can impersonate any tenant (`POST /api/admin/users/:id/impersonate`), so one leaked environment variable is silent read access to every tenant's customer DMs. Impersonation **start and end** are both audit-logged against the target tenant id — the exit record previously logged the admin's own id, making it impossible to pair a start with its end and bound which tenant was accessed.
3. **No secret leakage in responses**: Admin user endpoints (`/users`, `/users/:id`, `/support/search`, `/stats`, login) strip `passwordHash` via `sanitizeUser`. Access tokens are never returned.
4. **Strict CORS allowlist**: Credentialed cross-origin requests are honored only for `FRONTEND_URL` / `BACKEND_URL` / `ALLOWED_ORIGINS` (plus localhost in dev). Unknown origins receive no `Access-Control-Allow-Origin` header — the old reflect-any-origin behavior is gone.
5. **CSRF defense-in-depth**: `originGuard` rejects state-changing requests (`POST/PUT/PATCH/DELETE`) whose Origin/Referer is present but not allowlisted; the session cookie is `SameSite=lax` (override via `COOKIE_SAMESITE`).
6. **Security headers on every response**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security` (production).
7. **Rate limiting**: In-memory fixed-window limiter on `/auth/login`, `/auth/register`, and `/api/admin/login`; message pagination `take` is clamped to ≤ 100.
8. **Fail-closed secrets**: In production the server refuses to boot if `SESSION_SECRET` is unset/default, `INSTAGRAM_APP_SECRET` is unset, plaintext `ADMIN_PASSWORD` is present, or `ADMIN_USERNAME` is set without `ADMIN_PASSWORD_HASH`. Token encryption prefers a dedicated `TOKEN_ENCRYPTION_KEY` and never derives the key from a public default in production.
9. **Webhook secret required**: Signature verification rejects requests when `INSTAGRAM_APP_SECRET` is empty instead of computing an attacker-known empty-key HMAC.

---

## 4. Conversational Intelligence & Anti-Loop Pacing

### Anti-Loop & Conversational Guards (`messageAnalysisJob.js`)
1. **Closing / Acknowledgment Filter**: Detects when customers send short ending messages (`ok`, `okay`, `k`, `thanks`, `thank you`, `got it`, `sure`, `cool`, `noted`, `will check`, `bye`) and skips auto-replying so AI never creates an annoying endless loop.
2. **Consecutive Auto-Reply Limit (Max 2 consecutive replies)**: AI will only auto-respond up to 2 times in a row without human intervention. If the conversation continues beyond that, AI steps aside, flags `needsHuman: true` and `needsAttention: true`, and alerts the business owner for personal follow-up.
3. **Daily Rate Limit (Max 3 auto-replies / 24 hours per chat)**: Caps total automated messages per conversation to 3 within any rolling 24-hour window.

### Concurrency Safety (the guards above are read-then-act)
4. **Per-Conversation Send Claim**: Guards 2 and 3 count prior replies, then `await` an AI call, then send. Without a lock, two concurrent analysis jobs both read the pre-send counts, both pass, and **both send a DM to the same real customer** — worker concurrency is 3, so this fired on a single instance. `claimAutoReply()` takes an atomic claim via a conditional `updateMany` on `Conversation.autoReplyClaimedAt` **before** any counting, and releases it in a `finally`. A stale claim expires after 2 minutes so a crashed worker cannot wedge a conversation permanently.
5. **Atomic Analysis Writes**: The `AIAnalysis` insert, the conversation's denormalized fields, and the message status are one `$transaction`. A crash between them previously left an analysis row whose conclusions the conversation never adopted, plus a message stranded in `processing`.
6. **Stalled-Analysis Sweeper**: `sweepStalledAnalyses()` resets messages left in `processing` past 15 minutes back to `pending`, every 5 minutes. Nothing rescanned them before, so a crash meant a message was never classified.
7. **Race-Free Get-or-Create**: `BusinessProfile`, `CreatorPreference`, and `Subscription` use `upsert`. `BrandDeal.conversationId` is `@unique` with P2002 recovery, so concurrent analyses cannot create two deals for one conversation or fire duplicate notifications.

> **UNVERIFIED (multi-instance):** the sweeper and the retention job run on `setInterval` and will execute N times with N instances. Both are idempotent conditional `updateMany`s so duplicate runs are harmless, but this is reasoned, not tested — only exercised single-instance.

---

## 4b. Data Retention, Deletion & Legal Surfaces

1. **Public legal pages**: `/privacy`, `/terms`, `/data-deletion` are statically prerendered, require no login, and are linked from the landing footer. Meta App Review requires them to be publicly reachable.
2. **Meta data deletion callback**: `POST /data-deletion/instagram` verifies Meta's `signed_request` (HMAC-SHA256 over the base64url payload, timing-safe) **before** deleting anything, then erases the Instagram account and everything cascading from it, plus the owning `User` if no other account remains. Replies with `{ url, confirmation_code }`. Unauthenticated by design — the signature is the authentication.
3. **30-day webhook payload retention**: `WebhookLog.payload` holds customers' raw message text. `jobs/retentionJob.js` nulls it 30 days after receipt and keeps the metadata row. **The 30-day figure is stated on the `/privacy` page — change one and you must change the other.**
4. **`WebhookLog` cascades on account deletion** (was `SetNull`). Orphaned rows previously survived account deletion with customers' DM text intact, contradicting what `DELETE /auth/account` promises.

---

## 4c. Database & Migrations

- The Prisma datasource is **`postgresql`** in every environment, including tests. `DATABASE_URL` must be a Postgres connection string; a `file:` URL fails at client construction.
- **Migrations in `backend/prisma/migrations/` are the source of truth and are committed.** They were previously in `.gitignore`, which meant they could never reach the deploy image and `prisma migrate deploy` would have been a permanent no-op, silently falling back to `db push`.
- Apply with `npx prisma migrate deploy`. **Never `db push` against production** — it drifts the schema without a recorded migration.
- Postgres `LIKE` is case-sensitive where SQLite's was not, so every admin search uses `mode: 'insensitive'`. Re-check this on any new `contains` filter.

---

## 5. Test Suites & Verification Results

### Primary suite — `cd backend && npm test` (Vitest, 44 passing)
Runs against a throwaway PostgreSQL and applies `prisma migrate deploy` in setup, so every run also proves the committed migrations still apply to an empty database.

| File | Covers |
|---|---|
| `tests/oauth-backdoor.test.js` | Mock-OAuth backdoor removal (incl. a source-level assertion so it cannot silently return) |
| `tests/oauth-chain.test.js` | OAuth `state` issue/verify/replay, re-link refusal, non-leaky errors, audit entries, session fixation |
| `tests/admin-session.test.js` | Admin elevation rotates the session id without logging the regular user out |
| `tests/auto-reply-concurrency.test.js` | Two racing jobs send one reply, not two; atomic analysis writes; stalled-analysis sweeper |
| `tests/data-deletion.test.js` | `signed_request` verification, forged/tampered rejection, cascade deletion, 30-day retention |
| `tests/scopes-and-admin.test.js` | Requested scopes, admin hash enforcement, impersonation auditability |

Needs a Postgres instance (`TEST_DATABASE_URL` to override):
```bash
# Local Postgres (also serves as the dev database)
docker run -d --name codeback-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=codeback -p 55432:5432 postgres:16-alpine

# Separate database for the test suite — it drops and recreates its schema on
# every run, so it must never point at the dev database.
docker exec codeback-pg psql -U postgres -c "CREATE DATABASE codeback_test;"
```

### Legacy hand-run scripts
`backend/scripts/*.js` need a running server and a live database, are not part of `npm test`, and are not run in CI — so their pass counts are not tracked here.

`test-socket-isolation.js` TEST GROUP 4 (account re-linking) was **removed** and reimplemented in `tests/oauth-chain.test.js`: it drove the OAuth callback via the mock-OAuth backdoor, which no longer exists. The replacement covers strictly more cases.

### Frontend
`npm run build` in `frontend/`: 23/23 static routes compiled with 0 errors.

---

## 6. Important Rules & Directives
- **Maintain Session & Tenant Safety**: All queries must filter by `instagramAccount: { userId: req.userId }`.
- **Session is the only identity source**: Never re-introduce a client-supplied `user_id`/id fallback for authentication — identity comes solely from `req.session.userId`.
- **No secrets in responses**: Never return `passwordHash` or decrypted access tokens from any endpoint; route new user-facing payloads through `sanitizeUser`.
- **No credential defaults**: Admin and signing/encryption secrets must come from the environment; do not add hardcoded fallbacks.
- **Grounded AI Answers**: Never remove anti-hallucination system prompt constraints.
- **Never re-introduce a test/mock authentication path.** No magic codes, no magic tokens, no `NODE_ENV`-gated bypass in the OAuth flow. Tests seed via Prisma fixtures or stub the network boundary; they never need a backdoor in shipped code.
- **Regenerate the session on every privilege transition.** Use `startAuthenticatedSession()` from `lib/session.js` rather than assigning `req.session.userId` directly.
- **Ownership never transfers implicitly.** Any code path that could re-point an `InstagramAccount` at a different `userId` must refuse when history exists, and must write an audit entry either way.
- **Anything that sends a DM must hold the conversation claim.** New auto-send call sites go through the same `claimAutoReply()` / `finally`-release pattern, or they will duplicate messages to real customers under concurrency.
- **Migrations, not `db push`.** Schema changes ship as committed migrations applied with `migrate deploy`.
- **Keep the privacy policy and the code in sync.** The 30-day retention window, the data actually collected, and the third-party AI disclosure are load-bearing claims. Changing behaviour means changing `/privacy` in the same commit.

### Review-critical surfaces (frozen once App Review is submitted)
Changing any of these mid-review can invalidate it. Flag every change so the demo screencast can be re-recorded:
1. OAuth redirect URI and the `/auth/instagram/callback` route
2. The Instagram webhook path and its GET challenge-response handler
3. Privacy / terms / data-deletion URLs and routes
4. Requested permission scopes — currently **`instagram_business_basic` + `instagram_business_manage_messages` only**. Both `instagram_business_manage_comments` and `instagram_business_content_publish` were removed: no comment or publishing code exists anywhere in this repo, and undemonstrable permissions are a standard rejection reason.

### Known gaps (deferred, not forgotten)
- **No Socket.io Redis adapter.** Real-time breaks across instances; `disconnectUserSockets` only reaches the local instance.
- **Sessions are in-memory without `REDIS_URL`.** Every deploy logs everyone out, and **multi-instance OAuth fails entirely** because the CSRF `state` lives in the session.
- **Rate limiting is per-process and per-IP**, with no per-tenant limits, and none at all on the webhook or the AI-cost endpoints.
- **No Instagram token refresh.** Long-lived tokens expire around day 60 and nothing renews them or notifies the tenant; `notifyConnectionProblem()` exists but is never called.
- **Prompt injection**: customer DM text reaches the model with only `"` escaped; output shape is validated but provenance is not.
- **Unbounded queries** on `GET /api/conversations` and `/api/analytics/summary`.
