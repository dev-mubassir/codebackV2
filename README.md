# Codeback — AI-Powered Instagram DM Assistant & Creator Inbox SaaS

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748?logo=prisma)](https://www.prisma.io/)
[![Multi-Provider AI](https://img.shields.io/badge/AI-Gemini%20%7C%20xAI%20Grok%20%7C%20OpenAI-8E7CC3)](https://ai.google.dev/)
[![Security](https://img.shields.io/badge/Security-AES--256--GCM-success)](https://nodejs.org/api/crypto.html)

**Codeback** is a modern, high-performance Instagram DM Assistant and Creator CRM SaaS. It automatically syncs incoming Direct Messages via signature-verified Meta webhooks, categorizes and prioritizes conversations with resilient AI, extracts commercial brand deals into an actionable pipeline, drafts personalized responses matching the creator's tone, and provides an optional **per-conversation automated reply mode** — keeping creators in complete control of their account.

Built with a sleek, Cloudflare-inspired SaaS interface for maximum speed, clarity, and tenant-safe multi-account management.

> *"AI reads your Instagram DMs so you don't have to read all of them. You stay in total control of every outgoing message."*

---

## 🏛️ System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Next.js 16 App Router                            │
│                 (Cloudflare-Inspired SaaS Light Interface)                  │
│                                                                             │
│ ┌──────────────┐ ┌───────────┐ ┌─────────────┐ ┌──────────────┐ ┌─────────┐ │
│ │  AppShell    │ │ Dashboard │ │ Inbox & Chat│ │ Brand Deals  │ │ Settings│ │
│ └──────────────┘ └───────────┘ └─────────────┘ └──────────────┘ └─────────┘ │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ REST API + Socket.io Real-time
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                            Node.js Express Backend                          │
│                                                                             │
│ ┌────────────────────────┐ ┌───────────────────────┐ ┌────────────────────┐ │
│ │ Instagram OAuth (Form) │ │ Webhook Handler (HMAC)│ │ Socket.io Server   │ │
│ └────────────────────────┘ └───────────────────────┘ └────────────────────┘ │
└───────────────────┬──────────────────────────────────────┬──────────────────┘
                    │                                      │
┌───────────────────▼──────────────────┐ ┌─────────────────▼──────────────────┐
│ SQLite / Postgres (Prisma ORM)       │ │ Resilient Multi-Provider AI Engine │
│ • AES-256-GCM Encrypted IG Tokens    │ │ • Keyword Pre-filter (0ms)         │
│ • Strict Tenant & Session Isolation  │ │ • Gemini ⟷ xAI Grok ⟷ OpenAI       │
│ • Soft-Disconnect History Retention  │ │ • Automatic Zero-Downtime Failover │
└──────────────────────────────────────┘ └────────────────────────────────────┘
```

---

## ✨ Core SaaS Features

### 1. 📥 Real-Time Smart Inbox & Chat
- **Instant DM Syncing**: Incoming messages arrive via HMAC SHA-256 signature-verified Meta webhooks and stream instantly to the client via Socket.io.
- **Intelligent Classification**: Automatic categorization into `Brand Deals`, `Collaborations`, `Customers`, `Fans`, `General Questions`, `Support`, and `Spam`.
- **Deterministic Priority Scoring (0-100)**: Blends AI confidence with creator preferences for transparent, explainable inbox ordering.
- **24-Hour Messaging Window Radar**: Live countdown badge indicating Meta Graph API messaging eligibility.

### 2. ⚡ Per-Chat AI Auto-Reply (Granular Control)
- **Specific Chat Activation Only**: Global auto-reply is disabled by default to prevent unintentional messaging. Creators toggle auto-reply ON for specific conversations only.
- **Custom Chat-Level Prompts**: Define custom instructions for specific contacts (e.g., *"Provide my media kit link https://example.com/kit and ask for their campaign budget"*).
- **Settings Manager**: Dedicated settings dashboard to search, review, and toggle auto-reply across all conversation threads.
- **24h Window & Policy Guard**: Strictly adheres to Meta's 24-hour messaging policy and encrypts access tokens during automated dispatch.

### 3. 🔄 Multi-Provider AI Auto-Failover Chain
- **Zero-Downtime AI Resilience**: Seamless failover chain across **Google Gemini**, **xAI Grok**, and **OpenAI**.
- **Instant Shift on Errors**: If your primary AI provider hits a rate limit (HTTP 429), quota exhaustion, outage (HTTP 500/503), or invalid key, Codeback instantly shifts to the next configured provider.
- **Graceful Keyword Degradation**: If all external AI providers are unavailable, the system degrades to zero-latency keyword heuristics without dropping messages or breaking webhooks.

### 4. 🔥 Structured Brand Deal CRM Pipeline
- **Automatic Deal Extraction**: Parses brand name, campaign scope, budget amount, deliverables, and deadlines from conversational text.
- **Pipeline Stage Tracker**: Manage deals through `new`, `contacted`, `negotiating`, `confirmed`, `declined`, and `expired` stages.

### 5. 🛡️ Enterprise-Grade Security & Tenant Isolation
- **AES-256-GCM Encryption**: Instagram long-lived tokens are encrypted before disk storage.
- **Independent Session Namespaces**: Dedicated admin session isolation prevents cookie collision between admin panel and regular user accounts.
- **Socket.io Handshake Verification**: Socket room subscription validates session cookies to prevent unauthorized eavesdropping.
- **Soft-Disconnect History Protection**: Disconnecting an Instagram account preserves historical messages and contacts. Reconnecting the same Instagram User ID seamlessly restores access.

### 6. 📱 Mobile-Safe OAuth Flow
- Uses a client-side hidden form submission mechanism (`navigateToInstagramAuth()`) to prevent iOS/Android Universal Link hijacking and keep OAuth consent inside the browser.

### 7. 🎧 Superadmin Operations Hub (`/admin`)
- Real-time KPI monitoring (active accounts, message throughput, AI stats, failover counts).
- User management with instant account suspension and support inspection.
- Direct account operations: Force token refresh with Meta Graph API and re-subscribe webhooks.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Vanilla CSS Tokens, Axios, Socket.io-client |
| **Backend API** | Node.js v24, Express v4.21, Socket.io v4.8, Cookie-Parser, Express-Session |
| **Database & ORM** | SQLite (Local Dev) / PostgreSQL (Production), Prisma ORM v6.19 |
| **AI Providers** | Google Gemini (`gemini-flash-latest`, `gemini-flash-lite-latest`), xAI Grok (`grok-3-mini`, `grok-2-latest`), OpenAI (`gpt-4o-mini`, `gpt-4o`) |
| **Queue Engine** | In-Process Async Job Queue (Zero-Config) with BullMQ + Redis upgrade path |
| **Cryptography** | Node.js Crypto (AES-256-GCM, HMAC-SHA256) |

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** v18+ (Node.js v24 recommended)
- **Meta Developer Account** with an Instagram Professional App configured
- **ngrok** or Cloudflare Tunnel (for local webhook forwarding)

---

### 1. Environment Setup

Configure your environment files:

#### `backend/.env`
```env
# Meta / Instagram App
INSTAGRAM_APP_ID=your_meta_app_id
INSTAGRAM_APP_SECRET=your_meta_app_secret
WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token

# Database & Encryption
DATABASE_URL="file:./codeback.db"
SESSION_SECRET=your_64_char_session_secret
TOKEN_ENCRYPTION_KEY=your_64_char_hex_encryption_key

# URLs & Ports
PORT=5000
BACKEND_URL=http://localhost:5000
FRONTEND_URL=http://localhost:3000
REDIRECT_URI=http://localhost:5000/auth/instagram/callback

# AI Provider Configuration (Auto-Failover Chain)
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GROK_API_KEY=your_xai_grok_api_key          # Optional: xai-...
OPENAI_API_KEY=your_openai_api_key          # Optional: sk-...

# Admin Credentials
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=YourSecurePassword
```

#### `frontend/.env.local`
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
NEXT_PUBLIC_INSTAGRAM_APP_ID=your_meta_app_id
NEXT_PUBLIC_REDIRECT_URI=http://localhost:5000/auth/instagram/callback
```

---

### 2. Database Initialization & Backend Launch

```bash
cd backend
npm install
npx prisma db push    # Sync database schema with SQLite
npm run dev            # Start Express API server (Port 5000)
```

---

### 3. Frontend Launch

```bash
cd frontend
npm install
npm run dev            # Start Next.js App Router (Port 3000)
```

Visit `http://localhost:3000` to open the app.

---

### 4. Webhook Setup (Development)

Forward incoming Instagram webhooks to your local server:
```bash
ngrok http 5000
```
Set your Meta App's Instagram Webhook Callback URL to:
`https://<your-ngrok-subdomain>.ngrok-free.app/webhooks/instagram` with your `WEBHOOK_VERIFY_TOKEN`.

---

## 🧪 Comprehensive Automated Test Suites

Codeback includes comprehensive standalone verification test suites:

### 1. Tenant & Session Isolation Test Suite (29 Checks)
```bash
cd backend
node scripts/test-isolation.js
```
*Validates auth boundaries (401s), admin/user session separation, multi-tenant account isolation, conversation ownership protection, and Socket.io room security.*

### 2. Multi-Provider AI Auto-Failover Test Suite (10 Checks)
```bash
cd backend
node scripts/test-ai-failover.js
```
*Validates DM classification, brand deal extraction, summary generation, reply drafting, real-time provider failover simulation (Grok ➔ Gemini), and graceful degradation.*

### 3. Per-Conversation Auto-Reply Test Suite (11 Checks)
```bash
cd backend
node scripts/test-auto-reply.js
```
*Validates chat-level auto-reply toggle, settings list queries, background execution, Instagram Graph API message dispatch, and database audit logging.*

### 4. Full End-to-End System Test Suite
```bash
cd backend
node scripts/e2e-test.js
```

---

## 📡 REST API Reference

### Authentication & Accounts
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/instagram` | Initiates Instagram OAuth flow |
| `GET` | `/auth/instagram/callback` | Exchanges code for token & subscribes webhooks |
| `GET` | `/auth/me` | Returns current authenticated user and accounts |
| `POST` | `/auth/logout` | Clears user session cookie |
| `GET` | `/api/accounts` | Lists connected Instagram accounts for user |
| `DELETE` | `/api/accounts/:id` | Soft-disconnects IG account (`?purge=true` for permanent delete) |

### Conversations, Messages & Auto-Reply
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/conversations` | Lists conversations with filters (`category`, `priority`, `unread`, `important`) |
| `GET` | `/api/conversations/:id/messages` | Gets messages for a thread and marks conversation as read |
| `PATCH` | `/api/conversations/:id/auto-reply` | **Toggles AI Auto-Reply & custom prompt for a specific chat** |
| `GET` | `/api/conversations/:id/ai-analysis` | Fetches AI analysis, summary, and brand deal data |
| `POST` | `/api/conversations/:id/generate-reply` | Generates AI reply draft on-demand |
| `POST` | `/api/conversations/:id/reply` | Sends message via official Instagram Graph API |

### Settings & Automation
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/ai` | Returns creator AI preferences and tone |
| `PUT` | `/api/settings/ai` | Updates creator priorities, tone, and global instructions |
| `GET` | `/api/settings/auto-reply-chats` | **Lists all conversations with per-chat auto-reply statuses** |

### Brand Deals & Notifications
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/brand-deals` | Lists extracted brand deals |
| `PATCH` | `/api/brand-deals/:id` | Updates brand deal pipeline status |
| `GET` | `/api/notifications` | Lists notifications and unread alert count |
| `POST` | `/api/notifications/:id/read` | Marks a notification as read |

### Superadmin Portal (`/api/admin`)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/admin/login` | Superadmin authentication |
| `GET` | `/api/admin/me` | Validates admin session status |
| `GET` | `/api/admin/stats` | Returns platform KPIs and AI health stats |
| `GET` | `/api/admin/users` | Paginated user management list |
| `POST` | `/api/admin/users/:id/suspend` | Toggles account suspension |
| `POST` | `/api/admin/accounts/:id/refresh-token`| Forces long-lived token refresh with Meta API |
| `POST` | `/api/admin/accounts/:id/resubscribe-webhook` | Re-subscribes webhooks for account |
| `POST` | `/api/admin/logout` | Clears admin session |

---

## 🔒 Security Principles

1. **Strict Human-In-The-Loop Default**: Global auto-reply is off by default; outgoing replies require explicit creator action unless selectively enabled per chat.
2. **AES-256-GCM Token Encryption**: Long-lived Meta access tokens are encrypted with authenticated cipher integrity.
3. **HMAC-SHA256 Signature Verification**: Every incoming webhook payload is verified against `INSTAGRAM_APP_SECRET`.
4. **Tenant-Scoped Data Access**: Every database query verifies `instagramAccount: { userId: req.userId }`.
5. **Separated Admin Session State**: Admin authentication uses dedicated session fields to prevent user session hijacking.

---

## 📄 License

This project is licensed under the MIT License.
