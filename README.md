# Codeback — AI-Powered Instagram DM Assistant

Codeback reads a creator's Instagram DMs, understands them with AI, and helps the creator focus only on what matters — brand deals, collaborations, and customers — while never sending a single message without explicit human approval.

> "AI reads your Instagram DMs so you don't have to read all of them. You stay in control of every outgoing message."

## Architecture

```
                       Instagram
                           │
                           ▼
                    Webhook Endpoint  (signature-verified, fast, never blocks on AI)
                           │
                           ▼
                     Express Backend ───────────────► Instagram Graph API
                           │                            (OAuth, send messages, profiles)
                ┌──────────┴──────────┐
                ▼                     ▼
            SQLite/Postgres         Redis (optional)
           (source of truth)             │
                │                     BullMQ
                │                        │
                │                 AI Processing Worker
                │            (classification, priority, brand-deal
                │             extraction, summaries — all async)
                │                        │
                └───────────┬────────────┘
                             ▼
                       Codeback REST API
                             │
                             ▼
                        Next.js UI  ◄──── Socket.io (real-time)
                             │
                             ▼
                          Creator
```

If `REDIS_URL` is not configured, Codeback automatically falls back to an in-process async queue with the same interface (retries, backoff, concurrency limits) — so local development works out of the box, and enabling real Redis/BullMQ in production is a config change, not a code change. See `backend/src/lib/queue.js`.

## Core Product Rules

1. **AI never sends a message automatically.** AI only classifies, prioritizes, summarizes, and (on request) drafts. Only an explicit creator action (`POST /api/conversations/:id/reply`) reaches the Instagram API.
2. **Messages are never lost.** They're persisted before any AI processing happens; AI failures degrade to category `other` without hiding or blocking the message.
3. **Data is tenant-isolated.** Every query is scoped to the authenticated user's own accounts/conversations — never to a client-supplied id.
4. **History survives disconnects.** Disconnecting an Instagram account never deletes conversations/messages; it only marks the account inactive. Reconnecting the same account restores everything automatically.

## Prerequisites

- **Node.js** 18+ (https://nodejs.org)
- **A Meta Developer App** with the "Instagram" product enabled
- **ngrok** (or similar) to expose localhost for webhooks
- **Redis** (optional) — only needed if you want the production BullMQ queue instead of the built-in in-process fallback
- **An AI provider key** (optional) — Google Gemini (default) or OpenAI. Without one, Codeback still works: messages are received/stored/displayed, and AI classification gracefully falls back to "other"

## Meta App Configuration

### 1. Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com)
2. Create a new app → select **"Other"** → **"Business"** type
3. Add the **Instagram** product (Business Login for Instagram)

### 2. Configure Instagram Login

1. In your app settings, go to **Instagram > Basic Display**
2. Add the **OAuth Redirect URI**: `http://localhost:5000/auth/instagram/callback`
   - For production, use your actual domain
3. Note your **App ID** and **App Secret** from App Settings > Basic

### 3. Required Permissions

Your app needs these permissions (request in App Review for production):
- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments`
- `instagram_business_content_publish`

### 4. Configure Webhooks

1. Go to **Instagram > Webhooks** in your app dashboard
2. Set the **Callback URL**: `https://<your-ngrok-url>/webhooks/instagram`
3. Set the **Verify Token**: same as `WEBHOOK_VERIFY_TOKEN` in your `.env`
4. Subscribe to fields: `messages`, `message_reactions`, `messaging_seen`

> **Note:** Webhooks require HTTPS. Use ngrok to tunnel your local server:
> ```bash
> ngrok http 5000
> ```

## Quick Start

### 1. Clone and configure

```bash
# Copy the env template
cp .env.example backend/.env

# Edit backend/.env and fill in:
# - INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET
# - WEBHOOK_VERIFY_TOKEN (any random string, must match Meta App webhook config)
# - SESSION_SECRET (any random string)
# - GEMINI_API_KEY (optional — leave blank to run with AI degraded to "other")
```

### 2. Start the backend

```bash
cd backend
npm install
npx prisma db push    # Creates/updates the SQLite database
npm run dev            # Starts on http://localhost:5000
```

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev            # Starts on http://localhost:3000
```

### 4. Set up ngrok (for webhooks)

```bash
ngrok http 5000
```

Copy the ngrok HTTPS URL and configure it as your webhook URL in the Meta App dashboard.

### 5. Test the flow

1. Open `http://localhost:3000` in your browser
2. Click **"Connect with Instagram"**
3. Authorize the app with your Instagram Professional account
4. You'll be redirected to the dashboard
5. Click **"Open Inbox"** to view conversations
6. Send a DM to your Instagram account from another account
7. The message appears in real time; AI classifies it moments later in the background
8. Open the conversation, click **"✨ Generate Reply"** to get an AI draft, edit it, then **Send**

### 6. Run the automated test suite (no Meta credentials required)

```bash
cd backend
node scripts/e2e-test.js
```

This spawns the real server, simulates Instagram webhook deliveries (brand deal, spam, duplicate, echo, and a second tenant), and verifies persistence, deduplication, tenant isolation, AI-failure resilience, and the admin panel — all against the local database.

## Project Structure

```
codeback/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma        # Database schema (accounts, conversations,
│   │                             #  AI analyses, brand deals, notifications, ...)
│   ├── scripts/
│   │   └── e2e-test.js          # End-to-end regression test (see above)
│   ├── src/
│   │   ├── index.js             # Express server entry point
│   │   ├── jobs/
│   │   │   ├── index.js         # Wires the AI queue to its processor
│   │   │   └── messageAnalysisJob.js  # Classification/priority/brand-deal/summary pipeline
│   │   ├── lib/
│   │   │   ├── instagram.js     # Instagram Graph API helpers
│   │   │   ├── crypto.js        # AES-256-GCM token encryption
│   │   │   ├── prisma.js        # Shared Prisma Client singleton
│   │   │   ├── queue.js         # Redis/BullMQ queue with in-process fallback
│   │   │   ├── socket.js        # Shared Socket.io accessor
│   │   │   ├── notify.js        # Creator notification helper
│   │   │   └── constants.js     # Canonical AI category/priority definitions
│   │   ├── middleware/
│   │   │   ├── auth.js          # Session auth middleware
│   │   │   └── adminAuth.js     # Admin auth middleware
│   │   ├── routes/
│   │   │   ├── auth.js          # OAuth flow (connect Instagram)
│   │   │   ├── webhook.js       # Webhook handler (receive DMs, queue AI)
│   │   │   ├── api.js           # Conversations, messages, AI analysis, reply generation, reply
│   │   │   ├── accounts.js      # Account management (soft-disconnect)
│   │   │   ├── dashboard.js     # Creator Home / "While You Were Away"
│   │   │   ├── brandDeals.js    # Brand deal pipeline
│   │   │   ├── notifications.js # Notification center
│   │   │   ├── settings.js      # Creator AI preferences
│   │   │   ├── subscription.js  # Subscription + usage (billing-ready)
│   │   │   └── admin.js         # Admin panel API
│   │   └── services/
│   │       ├── aiService.js     # AI classification/priority/summary/reply generation
│   │       ├── preferencesService.js
│   │       ├── brandDealService.js
│   │       └── billingService.js
│   ├── .env                     # Environment variables (not committed)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.js          # Landing page
│   │   │   ├── dashboard/       # Creator Home + connected accounts
│   │   │   ├── inbox/           # Inbox (AI categories/priority, summaries,
│   │   │   │                     #  brand deal panel, Generate Reply/Send)
│   │   │   ├── brand-deals/     # Brand deal pipeline view
│   │   │   ├── notifications/   # Notification center
│   │   │   ├── settings/        # Creator AI preferences
│   │   │   └── admin/           # Admin panel (unchanged)
│   │   └── lib/
│   │       ├── api.js           # Backend API client
│   │       └── categories.js    # Shared, extensible category/priority metadata
│   ├── .env.local
│   └── package.json
├── .env.example                 # Environment template
└── README.md
```

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/instagram` | Start Instagram OAuth flow |
| GET | `/auth/instagram/callback` | OAuth callback handler |
| GET | `/auth/me` | Get current logged-in user |
| POST | `/auth/logout` | Log out |

### Conversations, AI & Replies
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/conversations` | List conversations (filter by `accountId`, `category`, `priority`, `unread`, `important`) |
| GET | `/api/conversations/:id/messages` | Get messages for a conversation (marks it read) |
| POST | `/api/conversations/:id/read` | Explicitly mark read/unread |
| GET | `/api/conversations/:id/ai-analysis` | Latest AI analysis, summary, and brand deal |
| POST | `/api/conversations/:id/generate-reply` | AI drafts a reply (never sends) |
| POST | `/api/conversations/:id/reply` | Send a reply — the only route that calls Instagram's send API |
| POST | `/api/contacts/:id/refresh-profile` | Force-refresh a contact's profile |

### Accounts, Dashboard, Brand Deals, Notifications, Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/accounts` | List connected IG accounts |
| DELETE | `/api/accounts/:id` | Soft-disconnect (history preserved); `?purge=true` to permanently delete |
| GET | `/api/dashboard/summary` | Creator Home metrics + "While You Were Away" |
| GET | `/api/brand-deals` / `/api/brand-deals/:id` | List/view brand deals |
| PATCH | `/api/brand-deals/:id` | Update a brand deal's pipeline status |
| GET | `/api/notifications` | List notifications |
| POST | `/api/notifications/:id/read` / `/read-all` | Mark notifications read |
| GET/PUT | `/api/settings/ai` | Read/update creator AI preferences |
| GET | `/api/subscription` | Subscription status (trial/active/past_due/cancelled/expired) |
| GET | `/api/usage` | Usage counters (messages, AI analyses, replies) |

### Webhook
| Method | Path | Description |
|--------|------|-------------|
| GET | `/webhooks/instagram` | Webhook verification (Meta) |
| POST | `/webhooks/instagram` | Receive webhook events (signature-verified, queues AI async) |

### Utility
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INSTAGRAM_APP_ID` | ✅ | Meta App ID |
| `INSTAGRAM_APP_SECRET` | ✅ | Meta App Secret |
| `WEBHOOK_VERIFY_TOKEN` | ✅ | Webhook verification token |
| `DATABASE_URL` | ✅ | SQLite: `file:./codeback.db` (swap to a Postgres URL in production) |
| `SESSION_SECRET` | ✅ | Session cookie secret |
| `TOKEN_ENCRYPTION_KEY` | ❌ | 64-char hex for AES-256 encryption |
| `PORT` | ❌ | Backend port (default: 5000) |
| `FRONTEND_URL` | ❌ | Frontend URL (default: http://localhost:3000) |
| `REDIRECT_URI` | ✅ | OAuth callback URL |
| `SKIP_SIGNATURE_VERIFICATION` | ❌ | Skip webhook signature check (dev only) |
| `AI_PROVIDER` | ❌ | `gemini` (default) or `openai` |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | ❌ | AI provider key. Without one, AI features degrade gracefully |
| `REDIS_URL` | ❌ | Enables the production BullMQ queue; omit to use the in-process fallback |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | ❌ | Dedicated admin panel credentials |
| `ADMIN_EMAILS` | ❌ | Comma-separated emails/usernames granted admin access |

## Security Notes

- **Tokens are encrypted** at rest using AES-256-GCM
- **Webhook signatures** are verified using `X-Hub-Signature-256` before any event is processed
- **Session cookies** are HTTP-only with SameSite protection
- **Tenant isolation** — every database query is scoped to the authenticated user; a client-supplied `user_id` is never trusted in production
- **24-hour messaging window** is enforced on the backend
- **Echo messages** (`is_echo`) are filtered to prevent duplicates
- **Idempotent webhook processing** — duplicate Instagram deliveries (including concurrent/racing deliveries) never create duplicate messages, contacts, or conversations

## Troubleshooting

### Webhook not receiving messages
- Make sure ngrok is running and the URL matches your Meta App config
- Check that the verify token matches
- Set `SKIP_SIGNATURE_VERIFICATION=true` temporarily for debugging
- Check the backend console logs for detailed webhook payloads

### OAuth callback fails
- Verify `REDIRECT_URI` matches exactly in both `.env` and Meta App settings
- Make sure your Instagram account is a Professional account (Business or Creator)
- Check the backend console for the specific error

### Can't reply to messages
- The 24-hour messaging window may have expired
- The user must send you a new message first
- Check the window status badge in the chat header

### AI classification always shows "Other"
- Set `GEMINI_API_KEY` (or `OPENAI_API_KEY` + `AI_PROVIDER=openai`) in `backend/.env`
- Check the backend console for `[AIService]` warnings
- This is a safe fallback, not a bug — messages are never lost or hidden due to AI failures
