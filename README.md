# Codeback — Generalized AI Instagram DM Customer Intelligence & Sales SaaS

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748?logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)](https://www.postgresql.org/)
[![Tests](https://img.shields.io/badge/Vitest-58%20passing-6E9F18?logo=vitest)](https://vitest.dev/)
[![Multi-Provider AI](https://img.shields.io/badge/AI-Gemini%20%7C%20xAI%20Grok%20%7C%20OpenAI-8E7CC3)](https://ai.google.dev/)
[![Security](https://img.shields.io/badge/Security-AES--256--GCM-success)](https://nodejs.org/api/crypto.html)

**Codeback** is a generalized, high-performance Instagram DM Customer Intelligence, Lead Qualification, Sales & Support SaaS. Built for **Video & Photo Editors, Product Sellers, Used Phone/Laptop Sellers, Clothing & Fashion Boutiques, Agencies, Freelancers, Coaches, E-commerce, and Content Creators**.

Codeback syncs incoming Direct Messages via signature-verified Meta webhooks, qualifies hot commercial leads, filters spam and threats, extracts sponsorship deals, and drafts replies **using only the business facts the owner entered**. Replies are drafted, never sent, unless the tenant explicitly opts in — see [Reply modes](#3--reply-modes-fail-closed-by-default).

---

## 🏛️ System Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       Next.js 16 App Router                                      │
│                             (Cloudflare-Inspired SaaS Light Interface)                           │
│                                                                                                  │
│ ┌──────────────┐ ┌───────────┐ ┌───────────────┐ ┌──────────────┐ ┌─────────────┐ ┌────────────┐ │
│ │  AppShell    │ │ Dashboard │ │ 3-Column Inbox│ │ Onboarding   │ │ Settings KB │ │ Profile    │ │
│ └──────────────┘ └───────────┘ └───────────────┘ └──────────────┘ └─────────────┘ └────────────┘ │
└───────────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                │ REST API + Socket.io Real-time
┌───────────────────────────────────────────────▼──────────────────────────────────────────────────┐
│                                    Node.js Express Backend                                       │
│                                                                                                  │
│ ┌────────────────────────┐ ┌───────────────────────┐ ┌─────────────────────┐ ┌─────────────────┐ │
│ │ Email/Pass Auth & OAuth│ │ Webhook Handler (HMAC)│ │ Socket.io Server    │ │ Account Deletion│ │
│ └────────────────────────┘ └───────────────────────┘ └─────────────────────┘ └─────────────────┘ │
└───────────────────────────┬─────────────────────────────────────────┬────────────────────────────┘
                            │                                         │
┌───────────────────────────▼──────────┐ ┌────────────────────────────▼────────────────────────────┐
│ PostgreSQL (Prisma ORM + migrations) │ │ Token-Optimized AI Engine & Real-time Synchronization    │
│ • Persistent Business Profile Context│ │ • Real-time Active Chat Stream Appending                │
│ • AES-256-GCM Encrypted IG Tokens    │ │ • Live Smart Folder Counter Badges                      │
│ • Strict Tenant & Session Isolation  │ │ • Non-Business Summary Suppression (0 AI Calls)        │
│ • Cascading Message/Account Deletion │ │ • Anti-Loop Pacing + Per-Conversation Send Claim         │
└──────────────────────────────────────┘ └─────────────────────────────────────────────────────────┘
```

---

## ✨ Core SaaS Features

### 1. ⚡ Live Real-Time Chat Updates & Smart Folder Synchronization
- **Active Open Chat Live Streaming**: When reading an open chat thread, new incoming customer DMs are appended to the screen in **real time (0ms delay)** with auto-scroll and instant read status synchronization via Socket.io.
- **Real-Time Smart Folder Counter Badges**: The sidebar folders display live numeric badges that update the moment a message or a new classification arrives, with no page refresh.
- **Folder matching** (`matchesFolder`):
  - `All` / `Unread`: everything, or `unread: true`.
  - `Needs your reply`: `needsAttention`, `needsHuman`, critical/high priority, or `priorityScore >= 70`. This folder absorbed the old `Needs Human` folder, which matched a strict subset of the same conversations under a second name.
  - `Hot leads`: `hot_lead` category, `purchaseIntent >= 80`, or hot-lead customer type.
  - `Leads and questions`: every commercial inquiry — services, products, pricing, availability, delivery.
  - `Customers`: returning buyers.
  - `General questions` / `Support`: FAQs, and after-sales or delivery follow-ups.
  - `Brand deals`: sponsorships and collaborations, which are one concept in the UI.
  - `Spam and scams`: filtered bots, phishing, and abuse.
- Folder icons come from the shared SVG set (`app/components/Icon.js`), not emoji.

### 2. 🔐 Email & Password Authentication + Dynamic Onboarding
- **Independent Application Auth**: Standard signup, login, and robust session termination (`POST /auth/logout`) with `bcryptjs` password hashing and secure session cookies (`codeback.sid`).
- **Interactive Onboarding Wizard (`/onboarding`)**: 3-step setup with pre-filled, production-ready knowledge templates for 12 business categories (Video Editor, Used Devices, Clothing Boutique, Freelancer, Agency, Coach, Creator, Photo Editor, Graphic Designer, Product Seller, Local Business, E-commerce), plus a clean custom template for `other`.
- **Persistent Business Profile (`BusinessProfile`)**: Ground-truth context storing business name, categories, products/services, pricing rates, turnaround times, shipping coverage, payment methods, FAQs, and tone.

### 3. 🔒 Reply Modes (Fail-Closed by Default)
Three stored modes on `BusinessProfile.autoReplyMode`, and **only `smart` can ever send a message**:

| Stored value | Shown as | Behaviour |
|---|---|---|
| `human_only` *(schema default)* | Manual | Nothing is ever sent. Every reply is written and sent by the owner. |
| `suggest_only` | Suggested replies | A draft is prepared; nothing leaves until the owner sends it. |
| `smart` | Automatic | Safe pricing, product, and service questions are answered on the owner's behalf. |

- **Fails closed.** `effectiveReplyMode()` in `jobs/messageAnalysisJob.js` is the single source for both gates. A user with **no `BusinessProfile` row — or an unsaved one — resolves to `human_only`, never `smart`.** Both gates previously used `|| 'smart'`, which inverted the schema default for exactly the accounts least likely to have finished setup: brand-new signups and reviewer test accounts. Anything that is not the literal string `smart` means do not send, so an empty or unrecognised value fails closed too.
- **Every surface reads the stored mode.** The dashboard states it outright, the inbox compose footer changes with it, and the account page shows the real value. No screen asserts a fixed claim about sending.
- The analysis pipeline runs in all three modes — classification, priority scoring, brand-deal extraction, summaries, notifications, live inbox updates. Only the send is withheld.

### 4. 🤖 Conversational Intelligence & Anti-Loop Pacing
- **Anti-Loop Acknowledgment Guard**: Automatically detects short closing/acknowledgment replies (`ok`, `thanks`, `got it`, `sure`, `cool`, `noted`, `will check`, `bye`) and skips auto-replying so AI never traps customers in an endless conversation loop.
- **Consecutive Auto-Reply Cap (Max 2 in a row)**: Limits AI to at most 2 consecutive auto-responses without a human reply. If the customer continues asking further follow-ups, AI cleanly steps aside, flags `needsHuman: true`, and alerts the business owner for personal handling.
- **Daily Rate Limiting (Max 3 auto-replies / 24 hours per chat)**: Enforces a strict daily ceiling per conversation thread.

### 5. ⚡ Processing Cost Optimization (Keyword Pre-Filter)
- **No provider call on non-business or spam messages**: If an incoming DM is not related to business, products, services, deals, or pricing (e.g. spam, scam, abusive, casual emoji/fan compliments), the system completely suppresses secondary Gemini/AI summary calls (0 extra API calls and 0 token cost).
- **Last 3 Messages Compact Summary**: When summarizing valid customer inquiries, AI only analyzes the **last 3 messages** instead of large chat histories, slashing token consumption by up to 80%.

### 6. 📥 3-Column Structured Inbox & Smart CRM (`/inbox`)
- **Column 1 (Dedicated Filter Sidebar)**: Vertically stacks Connected Accounts and Smart Inbox Folders with live real-time count badges, plus a bottom-left user Profile link.
- **Column 2 (Squeezed Conversation List Panel)**: 300px min-width list showing contact avatar, 24h window radar dot, name & timestamp pushed to opposite ends, single-line ellipsis message preview (`white-space: nowrap`), and wrapped commercial badges.
- **Column 3 (Main Chat Workspace)**: Collapsible **Conversation insights** panel (lead quality, buying intent, suggested next step, summary), a live 24-hour messaging-window countdown, the message stream, and the reply composer.
- **Clear messages & delete conversation**: `DELETE /api/conversations/:id/messages` clears history while keeping the contact and settings; `DELETE /api/conversations/:id` removes the thread and everything cascading from it.

### 7. 🛡️ Multi-Tenant Data Isolation & Security Hardening
- **Socket.io Handshake Session Authentication**: Mounts express-session directly on `io.engine.use(sessionMiddleware)`. Sockets are authenticated via `socket.request.session.userId` and auto-joined to `user:${userId}` on connection. Unauthenticated sockets and cross-tenant room join attempts are strictly rejected.
- **Socket Force-Disconnect on Logout**: `disconnectUserSockets(userId)` terminates all active real-time connections when a user session is destroyed.
- **Disconnected Instagram Account Safety**: Webhooks for disconnected accounts are cleanly skipped and logged without mutating state.
- **Account Re-Link Refusal**: Completing OAuth for an Instagram account that already holds **conversation history** under another workspace is refused with `409` and audit-logged (`ACCOUNT_RELINK_BLOCKED`). Ownership — and therefore every contact, conversation, and message — never transfers silently. Accounts with no history may transfer, and that too is audit-logged. The earlier guard only counted `BrandDeal` rows, so an account with thousands of DMs and no sponsorship deal moved between tenants unnoticed.
- **OAuth CSRF `state`**: `GET /auth/instagram` issues a 32-byte single-use `state`, stored on the session and verified with a timing-safe comparison **before** any token exchange with Meta. It is consumed whether or not it matches, so it can never be replayed, and expires after 10 minutes.
- **No Mock-OAuth Backdoor**: The `test_code_` / `mock_short_token_` / `mock_long_token_` short-circuits were **removed outright**, not gated behind an environment flag. They previously minted a token and profile for an arbitrary Instagram user id with no call to Meta whenever `NODE_ENV !== 'production'`.
- **Production Webhook Signature Gates**: Structural code-level gates ensure webhook signature verification can never be bypassed in production (`NODE_ENV=production`), and requests are rejected outright if `INSTAGRAM_APP_SECRET` is unset.

### 8. 🔒 Application Security Hardening
- **Session-Only Authentication**: Identity is derived exclusively from the server-side session — no client-supplied `user_id` is ever trusted (a former debug fallback that allowed account takeover by id was removed).
- **Session Regeneration on Every Privilege Transition**: Login, registration, OAuth completion, and admin elevation all issue a **new** session id via `lib/session.js`. Writing `userId` onto the session id the client already presented allowed session fixation — an attacker who planted a valid signed cookie rode the victim's login. Admin elevation deliberately carries an existing user session across the regeneration so opening the admin panel does not log a signed-in user out of the main app.
- **Hardened Admin Access**: Admin credentials come only from the environment, with **no hardcoded defaults**, constant-time comparison, and login rate limiting. First-user auto-admin promotion was removed. In production `ADMIN_PASSWORD_HASH` (bcrypt) is mandatory and the server **refuses to boot** if plaintext `ADMIN_PASSWORD` is set at all — an admin session can impersonate any tenant, so that variable is effectively a master key to every customer's DMs. Impersonation start *and* end are both audit-logged against the target tenant id.
- **No Secret Leakage**: `passwordHash` and access tokens are stripped from all API responses (`sanitizeUser`).
- **Strict CORS + CSRF Defense**: Credentialed requests are limited to an explicit origin allowlist (no wildcard reflection), a cross-origin request guard protects all state-changing routes, and session cookies use `SameSite=lax`.
- **Security Headers & Rate Limiting**: CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and HSTS (production) on every response; in-memory rate limiting on auth and admin-login endpoints.
- **Fail-Closed Secrets**: In production the server refuses to start with an unset/default `SESSION_SECRET`, a missing `INSTAGRAM_APP_SECRET`, a plaintext `ADMIN_PASSWORD`, or an `ADMIN_USERNAME` with no `ADMIN_PASSWORD_HASH`; token encryption uses a dedicated `TOKEN_ENCRYPTION_KEY` and never a public default.

### 9. 🔁 Concurrency & Duplicate-Send Protection
- **Per-Conversation Auto-Reply Claim**: The auto-reply gate counts prior replies, awaits an AI call, then sends — a read-then-act sequence spanning an `await`. Workers take an atomic claim (`Conversation.autoReplyClaimedAt`, a conditional `updateMany`) before counting anything, so two concurrent analysis jobs can no longer both pass the consecutive/daily guards and **both send a DM to the same real customer**. Worker concurrency is 3, so this fired on a single instance. The claim expires after 2 minutes, so a crashed worker cannot wedge a conversation.
- **Atomic Analysis Writes**: The AIAnalysis insert, the conversation's denormalized fields, and the message status are written in one `$transaction`. A crash mid-pipeline previously left an analysis row whose conclusions the conversation never adopted and a message stuck in `processing` forever.
- **Stalled-Analysis Sweeper**: Messages left in `processing` by a dead worker are reset to `pending` every 5 minutes so they are re-analyzed rather than silently never classified.
- **Race-Free Get-or-Create**: `BusinessProfile`, `CreatorPreference`, and `Subscription` use `upsert`, and `BrandDeal.conversationId` is now `@unique` with P2002 recovery — concurrent analyses can no longer create two deals for one conversation, nor fire duplicate notifications.

### 10. 📜 Legal Surfaces, Retention & Data Deletion
- **Public Legal Pages**: `/privacy`, `/terms`, and `/data-deletion` are statically prerendered, reachable without logging in, and linked from the landing-page footer — the surfaces Meta App Review requires.
- **Meta Data Deletion Callback**: `POST /data-deletion/instagram` implements Meta's `signed_request` contract, verifying the HMAC-SHA256 signature with a timing-safe comparison before deleting anything, and replying with the required `{ url, confirmation_code }`. A forged secret or a tampered payload deletes nothing.
- **30-Day Webhook Payload Retention**: `WebhookLog.payload` contains customers' raw message text. A scheduled job nulls it 30 days after receipt and keeps the non-content metadata row. Previously the only cleanup was a manual admin button, so these bodies were retained indefinitely.
- **Deletion Actually Deletes**: `WebhookLog` now cascades on account deletion instead of `SetNull`. Orphaned rows used to survive account deletion with customers' DM text intact, contradicting what `DELETE /auth/account` promises and what the privacy policy now states.

### 11. 🔤 Product Copy & Display Layer

Every human-readable string comes from one place, and **no raw stored value reaches a screen**.

| Module | Holds |
|---|---|
| `frontend/src/content/copy.js` | Static UI strings grouped by surface — `common`, `nav`, `dashboard`, `inbox`, `settings`, `account`, `auth`, `admin`, `errors`, `empty`, `toast`, `confirm`, `validation`, `meta` |
| `frontend/src/content/labels.js` | Display mapping for every enum, with a title-casing fallback so a value added to the backend before it is added here renders as "Hot Lead", never as raw `hot_lead` |
| `frontend/src/content/templates.js` | The thirteen starter business profiles, structurally parallel: same fields in the same order, four services, three priced lines, three FAQs each |
| `frontend/src/content/format.js` | One date format (`29 Aug 2026`), one currency format, correct pluralisation, and percentage suppression below a minimum sample size |
| `frontend/src/content/contact.js` | The public support address. **Throws during a production build if `NEXT_PUBLIC_SUPPORT_EMAIL` is unset** |

- **Storage and API payloads are unchanged.** `hot_lead`, `IGNORE_SPAM`, `human_only`, `NEEDS_RECONNECT` and the rest stay exactly as written by the backend; only what a person sees changed.
- **Analytics endpoints return keys and counts, not display strings.** `GET /api/analytics/summary` sends `categoryMetrics` with icon names and label keys; the frontend decides wording.
- **Card labels must match the query.** `autoRepliesSent` counts `direction: 'outbound', aiStatus: 'auto_replied'` — the status written at the moment a message is actually delivered to Instagram. It previously counted `aiStatus: 'completed'`, which marks an *inbound* message as classified, so a manual-mode account saw a large "AI Auto-Replied" number next to screens stating nothing is ever sent.
- **Percentages state their denominator** and are suppressed below 10 conversations, because "100%" of one conversation is noise.
- **Emoji are not UI furniture.** Icons come from `app/components/Icon.js`. Emoji survive only inside content a user typed.
- **AI prompts carry an output-style contract** governing length, tense, register, and forbidden vocabulary, plus real fallback copy for failure and timeout. Instructions only — no model, schema, or parameter changes.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Vanilla CSS Modules & Tokens, Axios, Socket.io-client |
| **Backend API** | Node.js v24, Express v4.21, Socket.io v4.8, Bcryptjs, Cookie-Parser, Express-Session |
| **Database & ORM** | PostgreSQL 16 (all environments), Prisma ORM v6.19 with committed migrations |
| **AI Providers** | Google Gemini (`gemini-flash-lite-latest`, `gemini-flash-latest`), xAI Grok (`grok-3-mini`, `grok-2-latest`), OpenAI (`gpt-4o-mini`, `gpt-4o`) |
| **Cryptography** | Node.js Crypto (AES-256-GCM, HMAC-SHA256, timing-safe comparison) |
| **Testing** | Vitest + Supertest (58 tests) against a throwaway PostgreSQL |

---

## ⚙️ Configuration

### Required in every environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | **PostgreSQL connection string.** The Prisma datasource is `postgresql`; a `file:` URL will fail at client construction. |
| `SESSION_SECRET` | ≥ 32 chars. No fallback — the server refuses to boot without it. |
| `TOKEN_ENCRYPTION_KEY` | 32-byte hex. Falls back to deriving from `SESSION_SECRET`, so **rotating `SESSION_SECRET` without this set makes every stored Instagram token undecryptable.** |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | Required in production; the app secret also authenticates the webhook and the data-deletion callback. |
| `WEBHOOK_VERIFY_TOKEN` | Meta webhook GET verification. |
| `REDIRECT_URI` | Must match the Meta dashboard entry **exactly**, no trailing slash. |
| `FRONTEND_URL` / `BACKEND_URL` | Also drive the CORS allowlist. |

### Required in production

| Variable | Notes |
|---|---|
| `NODE_ENV=production` | Enables secure cookies and the fail-closed gates. |
| `ADMIN_PASSWORD_HASH` | bcrypt hash. **Plaintext `ADMIN_PASSWORD` must be unset — the server refuses to boot if it is present.** Generate with `node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'your-password'`. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Frontend. Printed on `/privacy`, `/terms`, and `/data-deletion`, which Meta App Review opens directly. **The production build fails if it is unset** — it previously rendered the literal string `set NEXT_PUBLIC_SUPPORT_EMAIL` on those pages. Must be a mailbox a real person reads: deletion requests arrive there and the pages promise a reply within 30 days. |

### Recommended

| Variable | Notes |
|---|---|
| `REDIS_URL` | Without it, sessions are in-memory: every deploy logs all users out, and **multi-instance OAuth breaks entirely**, because the CSRF `state` lives in the session and the callback may land on an instance that never saw it. Also required before Socket.io can work across instances (no Redis adapter is wired yet). |

### Database migrations

Migrations in `backend/prisma/migrations/` are the schema's source of truth and are committed deliberately.

```bash
npx prisma migrate deploy   # production — never `db push`
```

---

## 🧪 Verification & Test Suites

### Automated suite (Vitest) — `npm test`

The primary suite runs against a **throwaway PostgreSQL** using `prisma migrate deploy`, so every run also proves the committed migrations still apply cleanly to an empty database.

```bash
cd backend && npm test    # 58 tests across 7 files
```

| File | Covers |
|---|---|
| `tests/oauth-backdoor.test.js` | Mock-OAuth backdoor is gone; magic prefixes reach the network like any other input |
| `tests/oauth-chain.test.js` | OAuth `state` issue/verify/replay, cross-tenant re-link refusal, non-leaky errors, audit entries, session fixation |
| `tests/admin-session.test.js` | Admin elevation rotates the session id without logging the regular user out |
| `tests/auto-reply-concurrency.test.js` | Two racing jobs send **one** reply, not two; atomic analysis writes; stalled-analysis sweeper |
| `tests/data-deletion.test.js` | Meta `signed_request` verification, forged/tampered rejection, cascade deletion, 30-day retention |
| `tests/scopes-and-admin.test.js` | Requested scopes, admin hash enforcement, impersonation auditability |
| `tests/auto-reply-fail-closed.test.js` | A missing or unsaved `BusinessProfile` never resolves to an auto-sending mode — asserted as a pure function and end to end through the real send path, plus the inverse (an explicit `smart` tenant still sends, so the gate is not simply off) |

The suite needs a PostgreSQL instance. Start a throwaway one with:

```bash
# Local Postgres (also serves as the dev database)
docker run -d --name codeback-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=codeback -p 55432:5432 postgres:16-alpine

# Separate database for the test suite — it drops and recreates its schema on
# every run, so it must never point at the dev database.
docker exec codeback-pg psql -U postgres -c "CREATE DATABASE codeback_test;"
```

Point it elsewhere with `TEST_DATABASE_URL`. The dev and production databases are never touched by the suite.

### Legacy hand-run scripts

`backend/scripts/*.js` are standalone programs requiring a running server and a live database. They are **not** part of `npm test` and their pass counts are not tracked here, because they are not run in CI:

```bash
node scripts/test-socket-isolation.js   # socket auth, room isolation, disconnected-account skipping, logout disconnect
node scripts/test-general-saas.js       # auth, onboarding, category intelligence, anti-hallucination
node scripts/test-auto-reply.js         # per-conversation auto-reply engine
node scripts/test-ai-failover.js        # multi-provider failover chain
node scripts/test-chat-delete.js        # clear chat / delete conversation
node scripts/test-isolation.js          # session isolation & tenant safety
```

> **Note:** `test-socket-isolation.js` TEST GROUP 4 (account re-linking) was removed and reimplemented in `tests/oauth-chain.test.js`. It drove the OAuth callback through the mock-OAuth backdoor, which no longer exists — the replacement covers strictly more cases.

### Frontend compilation

```bash
cd frontend && npm run build   # 23/23 static routes compiled with 0 errors
```

`next build` also enforces `NEXT_PUBLIC_SUPPORT_EMAIL`: the legal pages import `content/contact.js`, which throws when it is unset, so a missing support address fails the build rather than shipping a placeholder onto a compliance page.

### Seeding a tenant to click through

The dashboard, inbox, and admin cards only render meaningfully with data. To exercise them against real queries instead of empty state:

```bash
cd backend && node scripts/seed-review-tenant.js
```

Creates one tenant under `@test.codeback` with eight conversations spanning every category, a brand deal, and notifications. Reply mode is left at the schema default so the dashboard banner reads *Manual*. Remove it with `node scripts/cleanup-test-data.js --confirm`, which only ever matches that domain.
