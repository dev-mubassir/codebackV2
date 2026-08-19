# Codeback — Context Briefing

## Architecture

Codeback is an **AI-powered Instagram DM assistant** built as a SaaS platform. The architecture separates concerns between a Next.js frontend and an Express backend, with Instagram as the data source.

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Next.js Frontend  │────▶│   Express Backend    │────▶│ Instagram Graph │
│    (port 3000)      │     │    (port 5000)       │     │      API        │
│                     │ WS  │                      │     │                 │
│  • Landing page     │     │  • OAuth flow        │     │ • OAuth tokens  │
│  • AppShell Layout  │     │  • Webhook handler   │     │ • Send messages │
│  • Dashboard        │     │  • REST API          │     │ • User profiles │
│  • Inbox + Chat     │     │  • Socket.io         │     └─────────────────┘
│  • Brand Deals      │     └──────────┬───────────┘
│  • Notifications    │                │
│  • Settings         │     ┌──────────▼───────────┐
│  • Admin Panel      │     │    SQLite Database    │
└─────────────────────┘     │   (codeback.db)       │
                            └──────────────────────┘
```

### Core Data Flow

1. **OAuth**: User clicks "Connect Instagram" → hidden HTML form GET submission (bypasses mobile Universal Links/App Links) → redirects to Instagram → callback exchanges code for long-lived token → profile fetched → user/account saved (encrypted) → webhook subscribed → redirect to dashboard
2. **Webhook**: Meta sends DM events → signature verified → account matched by `igUserId` → contact found/created → conversation found/created → message saved → AI classification queued → Socket.io emits `new_message` to frontend
3. **Real-time**: Socket.io connections per user → `join` room by `userId` → new messages pushed instantly to frontend chat
4. **Replying**: Frontend sends reply text → backend decrypts token → `instagram.sendMessage()` → saves outbound message → updates conversation → emits to frontend
5. **Admin**: Separate admin login → `requireAdmin` middleware → full user/account management, token refresh, webhook resubscription, audit logs

### AI Pipeline (async, never blocks messaging)

1. Webhook receives message → persists immediately → queues `message.analysis` job
2. Job runs in background (Redis/BullMQ if `REDIS_URL` set, else in-process fallback)
3. AI classifies: category, priority, brand-deal extraction, summary
4. Appends append-only `AIAnalysis` record → updates conversation's denormalized `category`/`priority`/`needsAttention`
5. Notifications sent only for genuinely important events (brand deals, critical priority)
6. Live `analysis_completed` socket event updates inbox UI

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16 (App Router), React 19, axios, socket.io-client, Cloudflare-inspired light SaaS theme, Vanilla CSS tokens |
| **Backend** | Node.js, Express 4.21, Prisma ORM, SQLite (dev) / Postgres (swapable), bcrypt.js for password hashing |
| **AI** | Google Gemini 1.5 Flash (default) / OpenAI gpt-4o-mini (optional), with keyword pre-filtering to save costs |
| **Queue** | BullMQ + Redis (optional, `REDIS_URL` env var) or in-process fallback (zero-config) |
| **Auth** | Express-session cookies (HTTP-only, `sameSite: 'lax'`), no JWTs, no localStorage persistence |
| **Database** | SQLite (dev) / Postgres (swapable via Prisma schema), all tenant-scoped by `userId` |
| **Encryption** | AES-256-GCM for Instagram tokens at rest (`TOKEN_ENCRYPTION_KEY` env var) |
| **Testing** | 33 automated e2e checks (webhook → AI → persistence → isolation → admin → routes) + static build checks |

## Key Decisions & Why

| Decision | Reason |
|----------|--------|
| **Cloudflare SaaS Redesign** | Clean, production-grade light SaaS visual hierarchy with shared `AppShell` layout, color-coded badges, and responsive sidebar. |
| **Mobile Form OAuth Navigation** | Tapping Instagram OAuth links on mobile browsers previously triggered native app Universal Link hijacking. Using `navigateToInstagramAuth()` (hidden form GET) forces the browser to handle the OAuth flow completely in-browser. |
| **Async AI processing** | Messaging must never block on AI inference. Webhook responds `200` instantly; AI runs after. |
| **Soft-disconnect** | `Disconnect` flips `connectionStatus` to `DISCONNECTED` but never deletes conversations/messages. Reconnecting the same `igUserId` restores everything automatically. |
| **Tenant isolation via `userId`** | Every database query scopes to the authenticated user's `userId`. Never trust client-supplied ids. |
| **Empty-state AI defaults** | Without a Gemini key, classification gracefully falls back to `category: 'other'`, `priority: 'low'` — messages still appear, never hidden. |
| **In-process queue fallback** | `REDIS_URL` optional. If unset, Codeback uses a matching in-process queue with retries/backoff/concurrency — same interface, zero setup. |
| **No hardcoded secrets** | All secrets (`INSTAGRAM_APP_ID`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`) set in `.env`. `.env` files gitignored. |
| **`?user_id=` auth bypass disabled in production** | Security-hardened: `if (!isProduction && ...)` + warning log. |

## Tech Stack (Full)

- **Node.js** v24.15.0
- **Express** v4.21.0
- **Prisma** v6.19.3 (ORM, SQLite dev / Postgres swapable)
- **Next.js** v16.2.12 (App Router)
- **React** v19.2.4
- **socket.io** v4.8.0 / **socket.io-client** v4.8.3
- **BullMQ** v5.34.0 (optional, via `REDIS_URL`)
- **ioredis** v5.4.1 (Redis client)
- **Axios** v1.7.0 / v1.19.0
- **Crypto** built-in (AES-256-GCM, SHA-256)
- **ESLint** v9 (frontend)
- **dotenv** v16.4.0

## Current File Structure

```
codeback/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma          # DB schema (13 models)
│   ├── scripts/
│   │   ├── check-users.js
│   │   ├── clean-database.js
│   │   ├── clean-remaining.js
│   │   └── e2e-test.js            # 33 automated checks
│   ├── src/
│   │   ├── index.js               # Express entry point
│   │   ├── lib/
│   │   │   ├── instagram.js       # Graph API helpers
│   │   │   ├── crypto.js          # AES-256-GCM encryption
│   │   │   ├── prisma.js          # Shared Prisma client singleton
│   │   │   ├── queue.js           # Redis/BullMQ + in-process fallback
│   │   │   ├── socket.js          # Shared Socket.io accessor
│   │   │   ├── notify.js          # Creator notification helper
│   │   │   ├── constants.js       # Canonical categories/priorities
│   │   │   └── categories.js      # Extensible UI metadata
│   │   ├── middleware/
│   │   │   ├── auth.js            # Session auth
│   │   │   └── adminAuth.js       # Admin auth
│   │   └── routes/
│   │       ├── auth.js            # OAuth flow
│   │       ├── webhook.js           # Signature-verified, queues AI job
│   │       ├── api.js              # Conversations, messages, AI, replies
│   │       ├── accounts.js          # Soft-disconnect
│   │       ├── dashboard.js         # Creator Home
│   │       ├── brandDeals.js        # Brand deal pipeline
│   │       ├── notifications.js     # Notification center
│   │       ├── settings.js          # AI preferences
│   │       ├── subscription.js      # Subscription + usage
│   │       └── admin.js             # Admin panel API
│   │   └── services/
│   │       ├── aiService.js       # Classification/priority/summary/reply
│   │       ├── preferencesService.js
│   │       ├── brandDealService.js
│   │       └── billingService.js    # Abstraction (no provider wired yet)
│   ├── .env                       # Not committed
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── AppShell.js        # Shared authenticated SaaS shell
│   │   │   │   └── AppShell.module.css
│   │   │   ├── page.js                # Landing page
│   │   │   ├── page.module.css
│   │   │   ├── globals.css            # Centralized design system & tokens
│   │   │   ├── dashboard/               # Creator Home
│   │   │   ├── inbox/                     # Inbox + Chat
│   │   │   ├── brand-deals/               # Brand deals pipeline
│   │   │   ├── notifications/               # Notification center
│   │   │   ├── settings/                    # AI preferences
│   │   │   └── admin/                       # Admin panel
│   │   └── lib/
│   │       ├── api.js                 # Backend API client + mobile OAuth helper
│   │       └── categories.js            # Extensible UI metadata
│   ├── .env.local               # Not committed
│   └── package.json
├── CONTEXT.md               # Full project background & briefing
├── README.md                # Full product docs
└── package.json
```

## What's Done

- ✅ Cloudflare-style SaaS UI redesign across all frontend pages (Landing, Dashboard, Inbox, Brand Deals, Notifications, Settings, Admin)
- ✅ Shared `AppShell` component with active route indicators, mobile drawer overlay, and unread notification counter
- ✅ Mobile OAuth fix (`navigateToInstagramAuth()`) using hidden form GET submission to bypass mobile Universal Links / native Instagram app hijacking
- ✅ Verified all interactive button handlers, form submissions, dropdowns, and API client calls
- ✅ Database cleanup utility executed (zero records remaining in SQLite dev DB)
- ✅ Full Instagram OAuth flow (connect/reconnect)
- ✅ Webhook reception with signature verification
- ✅ Message persistence before AI processing
- ✅ Deduplication (igMessageId + contact/conversation race-condition guards)
- ✅ AI classification (keyword pre-filter → Gemini fallback → "other" if no key)
- ✅ Deterministic priority scoring (blended with creator preferences)
- ✅ Brand deal extraction (structured, merged across messages)
- ✅ Conversation summaries
- ✅ On-demand reply generation (never auto-sends; only `POST /api/conversations/:id/reply` reaches Instagram)
- ✅ Soft-disconnect (preserves history; `?purge=true` for irreversible delete)
- ✅ Tenant isolation (every query scoped to `userId`)
- ✅ Notifications & Creator AI preferences
- ✅ Admin panel (user management, accounts, support inspector, settings, audit logs)
- ✅ Static frontend build verified (`15/15` pages prerendered with 0 errors)
- ✅ `.env`/`.env.local` gitignored (never committed)

## What's Pending

- Real payment provider integration (Stripe/Paddle — `billingService.js` abstraction ready but unplugged)
- Real Redis/BullMQ queue (in-process fallback works identically; `REDIS_URL` enables production BullMQ)
- Production deployment setup
