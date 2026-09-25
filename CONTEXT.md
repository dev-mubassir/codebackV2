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
- `matchesFolder(conv, folderId)` classifies conversations across all folders. Folder **ids are unchanged** (they are URL parameters — `/inbox?filter=important` still works); only the labels moved to `lib/categories.js`:
  - `all` / `unread`: everything, or `unread: true`.
  - `important` → **"Needs your reply"**: `needsAttention`, `needsHuman`, critical/high priority, or `priorityScore >= 70`.
  - `hot_leads`: `hot_lead` category, `purchaseIntent >= 80`, or hot-lead customer type.
  - `leads` → **"Leads and questions"**: every commercial inquiry — services, products, pricing, availability, delivery.
  - `customers`, `questions`, `support`: returning buyers, FAQs, after-sales follow-ups.
  - `brand_deal` → **"Brand deals"**: `brand_deal` **or** `collaboration`. Sponsorships and collabs are one concept in the UI.
  - `spam`: spam, scam, and abusive.
- **The `needs_human` folder was removed from the sidebar.** Its predicate (`needsHuman || needsAttention`) is a strict subset of `important`, so it listed the same conversations under a second name. `matchesFolder` still handles the id, so an old bookmark or link resolves rather than 404s.
- Folder icons are names from `app/components/Icon.js`, never emoji.
- All counts update in real time via Socket.io without a page reload.

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
2. **Admin accounts (admin rebuild, 2026-09)**: Admins are `admin_users` rows created by `backend/scripts/create-admin.js` (see ADMIN.md) — no admin credential lives in the environment. Separate admin session (`siffty.admin.sid`, 30 min idle / 8 h absolute), Argon2id, lockout, password re-entry for destructive actions, a written reason and an audit row for every change, and a generic 404 to anyone who is not an admin. There is no impersonation and no DM viewer.
3. **No secret leakage in responses**: Admin user endpoints (`/users`, `/users/:id`, `/support/search`, `/stats`, login) strip `passwordHash` via `sanitizeUser`. Access tokens are never returned.
4. **Strict CORS allowlist**: Credentialed cross-origin requests are honored only for `FRONTEND_URL` / `BACKEND_URL` / `ALLOWED_ORIGINS` (plus localhost in dev). Unknown origins receive no `Access-Control-Allow-Origin` header — the old reflect-any-origin behavior is gone.
5. **CSRF defense-in-depth**: `originGuard` rejects state-changing requests (`POST/PUT/PATCH/DELETE`) whose Origin/Referer is present but not allowlisted; the session cookie is `SameSite=lax` (override via `COOKIE_SAMESITE`).
6. **Security headers on every response**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security` (production).
7. **Rate limiting**: In-memory fixed-window limiter on `/auth/login`, `/auth/register`, and `/api/admin/login`; message pagination `take` is clamped to ≤ 100.
8. **Fail-closed secrets**: In production the server refuses to boot if `SESSION_SECRET` is unset/default or `INSTAGRAM_APP_SECRET` is unset. Token encryption prefers a dedicated `TOKEN_ENCRYPTION_KEY` and never derives the key from a public default in production.
9. **Webhook secret required**: Signature verification rejects requests when `INSTAGRAM_APP_SECRET` is empty instead of computing an attacker-known empty-key HMAC.

---

## 4. Reply Modes (Fail-Closed)

`BusinessProfile.autoReplyMode` has three stored values, and **only the literal string `smart` may ever send a message**:

| Stored | Displayed | Sends without the owner? |
|---|---|---|
| `human_only` *(schema default)* | Manual | Never |
| `suggest_only` | Suggested replies | Never — drafts only |
| `smart` | Automatic | Yes, for safe qualifying questions |

1. **One resolver, failing closed.** `effectiveReplyMode(businessProfile)` in `jobs/messageAnalysisJob.js` is the single source for both gates (the caller gate and the re-assertion inside `maybeAutoReply`). It returns `human_only` for a null profile, a missing field, an empty string, or whitespace.
   Both gates previously read `businessProfile?.autoReplyMode || 'smart'`. The schema column defaults to `human_only` precisely so automatic sending is opt-in, and that fallback **inverted it for any user whose `BusinessProfile` row was missing or unsaved** — the state of a brand-new signup or an App Review test account. Because the landing page, dashboard, and inbox all state that nothing is sent without approval, this was a misrepresentation, not only a defect.
   Keeping the two gates independent is how the bug survived: the comment directly above the first gate already documented the correct behaviour while the code contradicted it. **Do not re-inline the fallback at either call site.**
2. **Anything not `smart` means do not send**, so an unrecognised or future mode fails closed rather than being guessed at.
3. **The per-conversation override can only subtract.** `Conversation.autoReplyEnabled` is three-state: `null` inherits the mode, `true` opts in, `false` opts out even under `smart`. It can never re-enable sending for a tenant who chose `suggest_only` or `human_only`.
4. **Analysis always runs.** Classification, priority scoring, brand-deal extraction, summaries, notifications, and live inbox updates happen in every mode. Only the send is withheld.
5. Covered by `tests/auto-reply-fail-closed.test.js`, which asserts the resolver directly and end to end through the real send path, including the inverse case so the gate cannot be trivially satisfied by being off.

---

## 4a. Conversational Intelligence & Anti-Loop Pacing

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

## 4c. Product Copy & Display Layer

Every human-readable string resolves through `frontend/src/content/`. **Storage and API payloads are never changed to suit display.**

| Module | Responsibility |
|---|---|
| `copy.js` | Static UI strings by surface: `common`, `nav`, `dashboard`, `inbox`, `settings`, `account`, `auth`, `admin`, `errors`, `empty`, `toast`, `confirm`, `validation`, `meta` |
| `labels.js` | Enum → label, with `titleCase()` fallback so an unmapped value renders as "Hot Lead", never `hot_lead` |
| `templates.js` | The thirteen starter business profiles, structurally parallel |
| `format.js` | One date format (`29 Aug 2026`), one currency format, pluralisation, percentage suppression |
| `contact.js` | Public support address; **throws at production build time** when `NEXT_PUBLIC_SUPPORT_EMAIL` is unset |

1. **Enum values are display-mapped at render time only.** `hot_lead`, `IGNORE_SPAM`, `human_only`, `NEEDS_RECONNECT`, `auto_replied` are stored and transmitted exactly as-is. `labels.js` never round-trips a label back into storage.
2. **Backend endpoints return keys and counts, not display strings.** `GET /api/analytics/summary` sends `categoryMetrics` entries carrying an icon *name* and a plain label; it no longer builds emoji headings or per-business-type titles.
3. **A card's label must describe what its query measures.** Where they disagree, change the label — unless the query is the bug. Two were:
   - `autoRepliesSent` counted `aiStatus: 'completed'`, the flag set on an **inbound** message once classified. It now counts `direction: 'outbound', aiStatus: 'auto_replied'`, written only when a message is actually delivered to Instagram.
   - Brand deals and spam were all-time counts under a date-range selector and never moved. Both are now scoped to the window. `needsAttention` stays all-time deliberately — it is a live queue, not an activity count, and its sublabel says so.
4. **No fabricated numbers.** A metric with a hardcoded fallback that looks live is hidden, not shown. `computePercentChange` returns `null` (not `100`) when the prior window was empty, and shares are suppressed below 10 conversations because "100%" of one is noise.
5. **Hidden, never deleted.** Removed UI is commented out with a `REMOVED-BY-COPY-AUDIT:` marker stating why and how to restore. Three exist: the inbox "Match Confidence" metric (a constant `?? 0.95` that rendered as a live 95%), the account page's duplicate "AI Business Context" card, and the settings Master ON/OFF buttons that fought with the select bound to the same field.
6. **Emoji are not UI furniture.** Icons come from `app/components/Icon.js`. Emoji survive only inside content a user typed.
7. **Form fields read `--form-text`.** One token sizes every input, textarea, and select. iOS keeps 16px via an `@supports (-webkit-touch-callout: none)` carve-out, because Safari zooms the page on a focused field below that size.

---

## 4d. Database & Migrations

- The Prisma datasource is **`postgresql`** in every environment, including tests. `DATABASE_URL` must be a Postgres connection string; a `file:` URL fails at client construction.
- **Migrations in `backend/prisma/migrations/` are the source of truth and are committed.** They were previously in `.gitignore`, which meant they could never reach the deploy image and `prisma migrate deploy` would have been a permanent no-op, silently falling back to `db push`.
- Apply with `npx prisma migrate deploy`. **Never `db push` against production** — it drifts the schema without a recorded migration.
- Postgres `LIKE` is case-sensitive where SQLite's was not, so every admin search uses `mode: 'insensitive'`. Re-check this on any new `contains` filter.

---

## 5. Test Suites & Verification Results

### Primary suite — `cd backend && npm test` (Vitest, 58 passing)
Runs against a throwaway PostgreSQL and applies `prisma migrate deploy` in setup, so every run also proves the committed migrations still apply to an empty database.

| File | Covers |
|---|---|
| `tests/oauth-backdoor.test.js` | Mock-OAuth backdoor removal (incl. a source-level assertion so it cannot silently return) |
| `tests/oauth-chain.test.js` | OAuth `state` issue/verify/replay, re-link refusal, non-leaky errors, audit entries, session fixation |
| `tests/admin-session.test.js` | Admin elevation rotates the session id without logging the regular user out |
| `tests/auto-reply-concurrency.test.js` | Two racing jobs send one reply, not two; atomic analysis writes; stalled-analysis sweeper |
| `tests/data-deletion.test.js` | `signed_request` verification, forged/tampered rejection, cascade deletion, 30-day retention |
| `tests/scopes-and-admin.test.js` | Requested scopes (old admin checks skipped; see `admin-auth.test.js`, `admin-hardening.test.js`) |
| `tests/auto-reply-fail-closed.test.js` | A missing/unsaved `BusinessProfile` never resolves to an auto-sending mode; asserted as a pure function and end to end, plus the inverse |

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

### Seeding a tenant to click through
Dashboard, inbox, and admin cards only render meaningfully with data, and a passing build does not catch a runtime error in a card that appears only when rows exist. `node scripts/seed-review-tenant.js` creates one `@test.codeback` tenant with eight conversations across every category, a brand deal, and notifications; reply mode is left at the schema default so the dashboard banner reads *Manual*. Remove with `node scripts/cleanup-test-data.js --confirm`, which matches only that domain.

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
- **Auto-send defaults must fail closed.** Never write `autoReplyMode || 'smart'`. Both gates call `effectiveReplyMode()`; a missing profile resolves to `human_only`. A new send path that re-inlines the fallback reintroduces automatic sending for every account that has not finished setup.
- **New user-facing strings go in `frontend/src/content/`,** not inline in a component. New enum values get a `labels.js` entry; the title-casing fallback is a safety net, not the destination.
- **A card's label must match its query.** If they diverge, fix the label — or the query, if the query is the bug — but never ship the two disagreeing. Percentages state their denominator and are suppressed below the minimum sample.
- **Never ship a metric with a hardcoded fallback that reads as live data.** Hide it behind a `REMOVED-BY-COPY-AUDIT` marker instead.
- **Enum values are display-mapped, never renamed in storage.** Changing a stored value is a migration, not a copy edit.

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
- **Nested `<button>` in the inbox conversation list.** The per-row delete button sits inside the row button, which React reports as a hydration error on every inbox load. Pre-dates the copy work; clicks still function.
- **`/admin` has no per-route `<title>`.** `admin/layout.js` is a client component and cannot export `metadata`; it inherits the root title. Needs a wrapper layout.
- **`aiStats` is process-local.** The admin "Message processing" counters live in one process's memory, reset on every restart, and undercount across instances. The panel subtitle says so, but the numbers are not trustworthy for anything but a rough sanity check.
- **`GET /api/admin/me` grants admin on a plain user session with `role === 'ADMIN'`,** a second authorisation path alongside the dedicated admin session. Reported, not changed.
- **Cloudflare caches Turbopack dev chunks for 4 hours.** `/_next/static/chunks/*` are served with `max-age=14400`, but Turbopack **reuses chunk filenames** across rebuilds, so the tunnel serves stale JS under a name whose content changed. Code edits can appear not to land. Exclude `/_next/static/` from the dev tunnel's cache rules.
