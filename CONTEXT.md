# Codeback — Context Briefing & Technical Master Document

## 1. Project Overview & Architecture

Codeback is a production-grade **AI-Powered Instagram DM Assistant and Creator CRM SaaS**. The platform connects to Instagram Professional accounts via official Meta Graph APIs, captures direct messages in real time using signature-verified webhooks, classifies and prioritizes conversations with resilient AI, extracts commercial brand opportunities, and provides on-demand and **selective per-conversation auto-reply capabilities**.

```text
┌─────────────────────────┐       ┌──────────────────────────┐       ┌─────────────────────┐
│   Next.js 16 Frontend   │──────▶│     Express Backend      │──────▶│   Instagram Graph   │
│       (Port 3000)       │       │       (Port 5000)        │       │         API         │
│                         │  WS   │                          │       │                     │
│  • AppShell Layout      │◀─────▶│  • OAuth Flow            │       │ • OAuth Tokens      │
│  • Inbox & Chat         │       │  • Webhook HMAC Handler  │       │ • Send API          │
│  • Brand Deals Pipeline │       │  • REST API              │       │ • User Profiles     │
│  • Per-Chat Auto-Reply  │       │  • Socket.io Gateway     │       └─────────────────────┘
│  • Settings & Admin     │       └─────────────┬────────────┘
└─────────────────────────┘                     │
                                                ▼
                                  ┌───────────────────────────┐
                                  │   SQLite / PostgreSQL     │
                                  │       (Prisma ORM)        │
                                  └───────────────────────────┘
```

---

## 2. Core Data Flows

### A. Instagram OAuth 2.0 (Mobile-Safe)
1. User clicks "Connect Instagram" on frontend.
2. `navigateToInstagramAuth()` triggers a client-side hidden HTML form `GET` submission to `/auth/instagram`. This prevents mobile OS Universal Links / App Links from hijacking the URL into the native Instagram app.
3. User authorizes permissions (`instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`).
4. Callback exchanges authorization code for short-lived token, then long-lived token (60 days).
5. Token is encrypted via **AES-256-GCM** using `TOKEN_ENCRYPTION_KEY` and saved to `InstagramAccount`.
6. Account is linked to `User` tenant; webhook subscription is activated.
7. Redirects to `/inbox`.

### B. Real-Time Webhook & AI Pipeline
1. Meta sends DM event payload to `/webhooks/instagram`.
2. HMAC SHA-256 signature is verified against `INSTAGRAM_APP_SECRET`.
3. Webhook handler matches account by `igUserId` and resolves/creates `Contact` and `Conversation`.
4. Message is persisted to `Message` table immediately with `aiStatus: 'pending'`.
5. Webhook responds HTTP `200 OK` in <50ms.
6. Emits `new_message` event over Socket.io room `user:${userId}`.
7. Asynchronous background job (`messageAnalysisJob.js`) processes the message:
   - Evaluates keyword pre-filter (0ms latency for obvious spam).
   - Calls **Resilient AI Multi-Provider Engine** (`Gemini` ⟷ `xAI Grok` ⟷ `OpenAI`).
   - Validates & sanitizes structured output.
   - Computes deterministic priority score (0-100) blended with creator preferences.
   - Appends append-only `AIAnalysis` record and updates conversation denormalized fields.
   - Extracts and upserts `BrandDeal` if commercial sponsorship detected.
   - Evaluates **Per-Conversation Auto-Reply**: If `conversation.autoReplyEnabled === true` and within the 24-hour Meta messaging window, AI drafts and automatically dispatches the reply via Instagram Graph API.
   - Emits `analysis_completed` and `new_message` events to creator inbox in real time.

### C. Admin & Support Isolation
1. Admin logs in via `/api/admin/login`.
2. Session receives `isAdmin: true` and `adminUserId: ...` in an isolated namespace that **does not overwrite the creator's `userId` session slot**.
3. Superadmin can inspect users, audit logs, trigger forced token refreshes, and test webhooks without corrupting user sessions in adjacent tabs.

---

## 3. Technology Stack

| Layer | Technology | Details |
|---|---|---|
| **Frontend** | Next.js 16 (App Router), React 19 | Cloudflare SaaS light theme, responsive CSS tokens, Socket.io-client |
| **Backend API** | Node.js v24, Express v4.21 | Modular architecture, `express-session`, CORS, cookie-parser |
| **Real-time Gateway** | Socket.io v4.8 | Authenticated handshake session verification, room-scoped messaging |
| **Database & ORM** | SQLite (Dev) / PostgreSQL (Prod), Prisma v6.19 | 15 relational tables, cascading tenant safety |
| **Multi-Provider AI** | Google Gemini, xAI Grok, OpenAI | Automatic failover chain with fallback to keyword engine |
| **Background Jobs** | In-Process Async Queue / BullMQ + Redis | Background job processing off the request/response cycle |
| **Cryptography** | Node.js Crypto | AES-256-GCM token encryption, HMAC-SHA256 signature verification |

---

## 4. Key Architectural & Security Decisions

| Area | Implementation Decision | Rationale |
|---|---|---|
| **Multi-Provider AI Auto-Failover** | `Gemini` ⟷ `xAI Grok` ⟷ `OpenAI` ⟷ `Rule-Based Fallback` | Prevents single-point-of-failure if an API key expires, encounters rate limits (429), or suffers an upstream outage. |
| **Per-Chat AI Auto-Reply** | `autoReplyEnabled` flag on `Conversation` (Default: `false`) | Global auto-reply is dangerous for creator brand reputation. Restricting auto-reply to specific chats gives creators 100% precision. |
| **Admin / User Session Separation** | Isolated session keys (`isAdmin`, `adminUserId`) | Prevents session collision when an admin logs in and switches to a user dashboard in another tab of the same browser. |
| **Removal of Dev-Mode Leakage Fallbacks** | Strict 401s and tenant boundaries in all environments | Eliminated legacy dev fallbacks that returned all accounts/conversations across users when an account was empty. |
| **Socket.io Handshake Auth** | Validates session cookie signature before room join | Blocks unauthorized clients from listening to another user's incoming DM stream. |
| **Soft-Disconnect Lifecycle** | Flips `connectionStatus` to `DISCONNECTED` | Disconnecting an account never purges historical chat history, contacts, or brand deals unless explicitly purged (`?purge=true`). |
| **24-Hour Messaging Window Radar** | Real-time calculation from `lastInbound.createdAt` | Prevents Meta API policy violations by blocking/alerting when the 24-hour reply window has elapsed. |

---

## 5. Current File Tree

```text
codeback/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma              # Database schema (15 models)
│   │   └── codeback.db                # SQLite database
│   ├── scripts/
│   │   ├── test-isolation.js          # 29 tenant & session isolation checks
│   │   ├── test-ai-failover.js        # 10 multi-provider AI failover checks
│   │   ├── test-auto-reply.js         # 11 per-chat auto-reply checks
│   │   ├── e2e-test.js                # Full end-to-end regression suite
│   │   └── verify-cleanup.js          # DB state verification
│   ├── src/
│   │   ├── index.js                   # Express server & Socket.io setup
│   │   ├── jobs/
│   │   │   └── messageAnalysisJob.js  # Async AI analysis & auto-reply worker
│   │   ├── lib/
│   │   │   ├── constants.js           # Categories, scores, priorities
│   │   │   ├── crypto.js              # AES-256-GCM encryption helpers
│   │   │   ├── instagram.js           # Meta Graph API SDK client
│   │   │   ├── notify.js              # Socket & notification dispatchers
│   │   │   ├── prisma.js              # Prisma Client singleton
│   │   │   ├── queue.js               # In-process / BullMQ queue abstraction
│   │   │   └── socket.js              # Socket.io helper singleton
│   │   ├── middleware/
│   │   │   ├── adminAuth.js           # Superadmin session verification
│   │   │   └── auth.js                # Tenant session verification
│   │   ├── routes/
│   │   │   ├── accounts.js            # Account management & soft-disconnect
│   │   │   ├── admin.js               # Superadmin portal API
│   │   │   ├── api.js                 # Conversations, messages, auto-reply toggle
│   │   │   ├── auth.js                # Instagram OAuth consent & callback
│   │   │   ├── brandDeals.js          # Brand deal pipeline CRUD
│   │   │   ├── dashboard.js           # Dashboard KPIs and summary
│   │   │   ├── notifications.js       # In-app notifications
│   │   │   ├── settings.js            # Creator AI preferences & auto-reply chats
│   │   │   ├── subscription.js        # Billing abstraction
│   │   │   └── webhook.js             # Meta webhook ingress & HMAC validation
│   │   └── services/
│   │       ├── aiService.js           # Resilient multi-provider AI coordinator
│   │       ├── billingService.js      # Plan & subscription abstraction
│   │       ├── brandDealService.js    # Deal extraction & merging
│   │       └── preferencesService.js  # Creator preference defaults
│   ├── .env                           # Local environment config (gitignored)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── AppShell.js        # Unified navigation layout
│   │   │   │   └── AppShell.module.css
│   │   │   ├── admin/                 # Superadmin portal UI
│   │   │   ├── brand-deals/           # Brand CRM pipeline UI
│   │   │   ├── dashboard/             # Creator home dashboard UI
│   │   │   ├── inbox/                 # Inbox, Chat view, Auto-reply controls
│   │   │   ├── notifications/         # Notification center UI
│   │   │   ├── settings/              # Settings & Per-Chat Auto-Reply Manager
│   │   │   ├── globals.css            # Design tokens & utilities
│   │   │   └── page.js                # Marketing landing page
│   │   └── lib/
│   │       ├── api.js                 # API client with credentials & helpers
│   │       └── categories.js          # Category badges & icons
│   ├── .env.local                     # Frontend environment config (gitignored)
│   └── package.json
├── CONTEXT.md                         # This context master briefing
├── README.md                          # Public product documentation
└── package.json
```

---

## 6. Completed Work & Current Status

- [x] **Multi-Provider AI Resilience**: Built automatic failover across Google Gemini, xAI Grok, and OpenAI with zero downtime on rate limits or API key failures.
- [x] **Per-Conversation AI Auto-Reply**: Implemented granular chat-level auto-reply toggle, status banner, custom prompt editor, settings manager, and background Graph API message dispatch.
- [x] **Tenant & Session Security**: Fixed admin/user session collision, removed dev-mode cross-tenant data leakage fallbacks, and added Socket.io handshake authentication.
- [x] **Database & Schema**: Added `autoReplyEnabled` and `autoReplyPrompt` to `Conversation` model; synced SQLite database.
- [x] **Automated Verification**:
  - `test-isolation.js`: **29/29 Passed**
  - `test-ai-failover.js`: **10/10 Passed**
  - `test-auto-reply.js`: **11/11 Passed**
- [x] **Git Repository**: Committed and pushed all clean code to `origin/master`.
- [x] **Documentation**: Rewrote `README.md` and updated `CONTEXT.md`.

---

## 7. Next Steps & Roadmap

1. **Payment Provider Integration**: Wire real payment gateway (Stripe / Lemon Squeezy) to `billingService.js` and subscription routes.
2. **Production Redis Deployment**: Configure `REDIS_URL` for distributed BullMQ processing across multiple backend replicas.
3. **Instagram Direct Message Templates**: Support media / image attachment replies and quick-reply buttons via Graph API.
