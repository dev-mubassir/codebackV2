# Codeback — AI-Powered Instagram DM Assistant SaaS

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748?logo=prisma)](https://www.prisma.io/)
[![Google Gemini](https://img.shields.io/badge/AI-Gemini_1.5_Flash-8E7CC3?logo=google)](https://ai.google.dev/)

**Codeback** reads a creator's Instagram Direct Messages, classifies and prioritizes them with AI, extracts commercial brand deals into a pipeline, and drafts personalized replies — while **never sending a single message without explicit creator approval**.

Designed with a Cloudflare-inspired SaaS interface for maximum data clarity, speed, and responsive control.

> *"AI reads your Instagram DMs so you don't have to read all of them. You stay in full control of every outgoing message."*

---

## 🏛️ System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Next.js 16 App Router                            │
│                 (Cloudflare-Inspired SaaS Light Interface)                  │
│                                                                             │
│ ┌──────────────┐ ┌───────────┐ ┌─────────────┐ ┌──────────────┐ ┌─────────┐ │
│ │  AppShell    │ │ Dashboard │ │ Inbox & Chat│ │ Brand Deals  │ │ Admin   │ │
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
│ SQLite / Postgres (Prisma ORM)       │ │ Async Background AI Engine         │
│ • AES-256-GCM Encrypted IG Tokens    │ │ • Keyword Pre-filter (0ms)         │
│ • Tenant-Isolated Data Scoping       │ │ • Gemini 1.5 Flash / OpenAI        │
│ • Soft-Disconnect History Protection │ │ • In-Process / BullMQ Queue        │
└──────────────────────────────────────┘ └────────────────────────────────────┘
```

---

## ✨ Core SaaS Features

- **⚡ Cloudflare-Style SaaS Interface**: Sleek light theme, persistent dark sidebar, clean typography, responsive layout, and data density.
- **📥 Real-Time AI Inbox**: Instant DM syncing via signature-verified webhooks and Socket.io push updates.
- **📱 Universal Link Safe Mobile OAuth**: Uses a client-side hidden form submission technique (`navigateToInstagramAuth()`) to bypass iOS/Android native app link hijacking, guaranteeing the OAuth flow stays inside the browser.
- **🤖 Intelligent DM Classification**: Automatic tagging into `Brand Deals`, `Collaborations`, `Customers`, `Fans`, `General Questions`, and `Spam`.
- **🔥 Automated Brand Deal Pipeline**: Structured extraction of brand names, campaign scopes, budgets, deliverables, and deadlines with pipeline stage management (`new`, `contacted`, `negotiating`, `confirmed`, `declined`).
- **✨ On-Demand AI Draft Suggestions**: AI drafts replies matching the creator's voice and tone. **Drafts are never auto-sent** — only an explicit creator action (`POST /api/conversations/:id/reply`) transmits to Instagram.
- **🔐 Multi-Tenant Security & Encryption**: AES-256-GCM encrypted Instagram tokens at rest, `SameSite` session security, and full `userId` database query scoping.
- **🛡️ Emergency Soft-Disconnect**: Disconnecting an Instagram account preserves all historical conversations, contacts, and brand deal data. Reconnecting the same IG user ID restores access seamlessly.
- **🎧 Full Admin & Support Control Panel**: Dedicated superadmin interface (`/admin`) for inspecting user accounts, monitoring AI performance, forcing token refreshes, re-subscribing webhooks, and read-only support inspection.

---

## 🛠️ Tech Stack

| Component | Stack |
|---|---|
| **Frontend Framework** | Next.js 16 (App Router), React 19, Vanilla CSS Tokens |
| **Backend API** | Node.js v24, Express v4.21, Socket.io v4.8 |
| **Database & ORM** | SQLite (Dev) / PostgreSQL (Prod), Prisma ORM v6.19 |
| **AI Processing** | Google Gemini 1.5 Flash (default), OpenAI `gpt-4o-mini` (optional), Keyword Pre-filter |
| **Queue Engine** | Zero-config In-Process Queue with automatic BullMQ + Redis upgrade path |
| **Token Security** | AES-256-GCM Cryptographic Encryption (`TOKEN_ENCRYPTION_KEY`) |

---

## 🚀 Quick Start & Setup

### Prerequisites

- **Node.js** v18+ (v24 recommended)
- **Meta Developer Account** with an Instagram App configured (Business Login for Instagram)
- **ngrok** (or Cloudflare Tunnel) to forward webhooks to localhost during development

---

### 1. Environment Configuration

Copy `.env.example` or create `.env` in `backend/` and `frontend/.env.local`:

**`backend/.env`**:
```env
INSTAGRAM_APP_ID=your_meta_app_id
INSTAGRAM_APP_SECRET=your_meta_app_secret
WEBHOOK_VERIFY_TOKEN=your_custom_verify_token
DATABASE_URL="file:./codeback.db"
SESSION_SECRET=your_long_random_session_secret
TOKEN_ENCRYPTION_KEY=64_character_hex_string_for_aes_256
PORT=5000
BACKEND_URL=http://localhost:5000
FRONTEND_URL=http://localhost:3000
REDIRECT_URI=http://localhost:5000/auth/instagram/callback
GEMINI_API_KEY=your_gemini_api_key
```

**`frontend/.env.local`**:
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:5000
NEXT_PUBLIC_INSTAGRAM_APP_ID=your_meta_app_id
NEXT_PUBLIC_REDIRECT_URI=http://localhost:5000/auth/instagram/callback
```

---

### 2. Backend Setup & Start

```bash
cd backend
npm install
npx prisma db push    # Initialize database schema
npm run dev            # Runs Express server on port 5000
```

### 3. Frontend Setup & Start

```bash
cd frontend
npm install
npm run dev            # Runs Next.js app on port 3000
```

---

### 4. Running Webhook Tunnel (Development)

In a new terminal window:
```bash
ngrok http 5000
```
Update your Meta Developer App's Instagram Webhook callback URL to `https://<your-ngrok-subdomain>/webhooks/instagram` with your `WEBHOOK_VERIFY_TOKEN`.

---

## 🧪 Automated Test Suite

Run the full end-to-end regression test suite without needing active Meta credentials:

```bash
cd backend
node scripts/e2e-test.js
```

The test suite validates:
- Webhook reception & HMAC signature verification
- Message persistence before AI background jobs
- Multi-tenant query isolation
- Deduplication of Instagram message IDs (`igMessageId`)
- AI failure resilience (fallback to `other` without data loss)
- Admin authentication and support inspection

---

## 📡 API Endpoint Overview

### Auth & Accounts
| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/instagram` | Initiates Instagram OAuth consent flow |
| `GET` | `/auth/instagram/callback` | Exchanges code for long-lived token & subscribes webhooks |
| `GET` | `/auth/me` | Fetches active authenticated user & connected accounts |
| `POST` | `/auth/logout` | Clears user session cookie |
| `GET` | `/api/accounts` | Lists connected Instagram accounts |
| `DELETE` | `/api/accounts/:id` | Soft-disconnects IG account (preserves data; `?purge=true` deletes) |

### Messaging, AI & Brand Deals
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/conversations` | Fetches conversations (filters: `category`, `priority`, `unread`, `important`) |
| `GET` | `/api/conversations/:id/messages` | Fetches conversation messages & marks thread read |
| `GET` | `/api/conversations/:id/ai-analysis` | Gets AI classification, stage summary, and extracted brand deal |
| `POST` | `/api/conversations/:id/generate-reply` | Asynchronously drafts an AI reply (does NOT send) |
| `POST` | `/api/conversations/:id/reply` | Sends reply via official Instagram Graph API |
| `GET` | `/api/brand-deals` | Lists extracted commercial opportunities |
| `PATCH` | `/api/brand-deals/:id` | Updates brand deal pipeline status (`new`, `negotiating`, `confirmed`) |

### Administration
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/login` | Superadmin authentication |
| `GET` | `/api/admin/users` | Paginated user management |
| `POST` | `/api/admin/users/:id/suspend` | Toggles user account suspension |
| `POST` | `/api/admin/users/:id/impersonate` | Enables support override impersonation |
| `POST` | `/api/admin/accounts/:id/refresh-token` | Forces long-lived token renewal with Meta API |
| `POST` | `/api/admin/accounts/:id/resubscribe-webhook` | Re-registers Instagram webhook subscriptions |

---

## 🔒 Security & Data Privacy

1. **AES-256-GCM Encryption**: Instagram long-lived access tokens are encrypted before being written to disk.
2. **HMAC Webhook Verification**: `X-Hub-Signature-256` signatures are validated for every incoming Meta payload.
3. **Strict Human-In-The-Loop**: AI never auto-responds to Direct Messages. All outgoing messages require explicit creator input.
4. **Tenant Isolation**: Every database query is strictly scoped to `req.session.userId`.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
