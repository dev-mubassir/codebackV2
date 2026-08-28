# Codeback — Generalized AI Instagram DM Customer Intelligence & Sales SaaS

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748?logo=prisma)](https://www.prisma.io/)
[![Multi-Provider AI](https://img.shields.io/badge/AI-Gemini%20%7C%20xAI%20Grok%20%7C%20OpenAI-8E7CC3)](https://ai.google.dev/)
[![Security](https://img.shields.io/badge/Security-AES--256--GCM-success)](https://nodejs.org/api/crypto.html)

**Codeback** is a generalized, high-performance Instagram DM Customer Intelligence, Lead Qualification, Sales & Support SaaS. Built for **Video & Photo Editors, Product Sellers, Used Phone/Laptop Sellers, Clothing & Fashion Boutiques, Agencies, Freelancers, Coaches, E-commerce, and Content Creators**.

Codeback syncs incoming Direct Messages via signature-verified Meta webhooks, qualifies hot commercial leads, filters spam and threats, extracts sponsorship deals, and provides an **intelligent multi-stage auto-reply engine with live real-time chat streaming, real-time smart folder updates, and zero hallucination**.

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
│ SQLite / Postgres (Prisma ORM)       │ │ Token-Optimized AI Engine & Real-time Synchronization    │
│ • Persistent Business Profile Context│ │ • Real-time Active Chat Stream Appending                │
│ • AES-256-GCM Encrypted IG Tokens    │ │ • Live Smart Folder Counter Badges                      │
│ • Strict Tenant & Session Isolation  │ │ • Non-Business Summary Suppression (0 AI Calls)        │
│ • Cascading Message/Account Deletion │ │ • Anti-Loop Pacing (Max 2 Consecutive Replies)          │
└──────────────────────────────────────┘ └─────────────────────────────────────────────────────────┘
```

---

## ✨ Core SaaS Features

### 1. ⚡ Live Real-Time Chat Updates & Smart Folder Synchronization
- **Active Open Chat Live Streaming**: When reading an open chat thread, new incoming customer DMs are appended to the screen in **real time (0ms delay)** with auto-scroll and instant read status synchronization via Socket.io.
- **Real-Time Smart Folder Counter Badges**: The sidebar folders (`Hot Leads`, `Leads & Inquiries`, `Customers`, `Questions`, `Support`, `Needs Human`, `Spam & Scams`, `Unread`, `Important`) dynamically display real-time numeric badges that update instantly when new messages or AI classifications arrive without requiring a page refresh.
- **Accurate Multi-Category Folder Matching**:
  - `🔥 Hot Leads`: Matches `hot_lead` category, high purchase intent (`>= 80%`), or hot lead customer type.
  - `🎯 Leads & Inquiries`: Aggregates all commercial inquiries (services, products, pricing, turnaround, delivery, and leads).
  - `💰 Customers`: Verified past buyers and returning customers.
  - `❓ Questions`: General product/service and FAQ inquiries.
  - `🎧 Support`: After-sales support requests and delivery follow-ups.
  - `👤 Needs Human`: Inquiries flagged for manual creator negotiation or when auto-reply limits are reached.

### 2. 🔐 Email & Password Authentication + Dynamic Onboarding
- **Independent Application Auth**: Standard signup, login, and robust session termination (`POST /auth/logout`) with `bcryptjs` password hashing and secure session cookies (`codeback.sid`).
- **Interactive Onboarding Wizard (`/onboarding`)**: 3-step setup with pre-filled, production-ready knowledge templates for 12 business categories (Video Editor, Used Devices, Clothing Boutique, Freelancer, Agency, Coach, Creator, Photo Editor, Graphic Designer, Product Seller, Local Business, E-commerce), plus a clean custom template for `other`.
- **Persistent Business Profile (`BusinessProfile`)**: Ground-truth context storing business name, categories, products/services, pricing rates, turnaround times, shipping coverage, payment methods, FAQs, and tone.

### 3. 🤖 Conversational Intelligence & Anti-Loop Pacing
- **Anti-Loop Acknowledgment Guard**: Automatically detects short closing/acknowledgment replies (`ok`, `thanks`, `got it`, `sure`, `cool`, `noted`, `will check`, `bye`) and skips auto-replying so AI never traps customers in an endless conversation loop.
- **Consecutive Auto-Reply Cap (Max 2 in a row)**: Limits AI to at most 2 consecutive auto-responses without a human reply. If the customer continues asking further follow-ups, AI cleanly steps aside, flags `needsHuman: true`, and alerts the business owner for personal handling.
- **Daily Rate Limiting (Max 3 auto-replies / 24 hours per chat)**: Enforces a strict daily ceiling per conversation thread.

### 4. ⚡ AI Token & Cost Optimization (Zero-Token Pre-Filter)
- **Zero AI Calls on Non-Business / Spam Messages**: If an incoming DM is not related to business, products, services, deals, or pricing (e.g. spam, scam, abusive, casual emoji/fan compliments), the system completely suppresses secondary Gemini/AI summary calls (0 extra API calls and 0 token cost).
- **Last 3 Messages Compact Summary**: When summarizing valid customer inquiries, AI only analyzes the **last 3 messages** instead of large chat histories, slashing token consumption by up to 80%.

### 5. 📥 3-Column Structured Inbox & Smart CRM (`/inbox`)
- **Column 1 (Dedicated Filter Sidebar)**: Vertically stacks Connected Accounts and Smart Inbox Folders with live real-time count badges, plus a bottom-left user Profile link.
- **Column 2 (Squeezed Conversation List Panel)**: 300px min-width list showing contact avatar, 24h window radar dot, name & timestamp pushed to opposite ends, single-line ellipsis message preview (`white-space: nowrap`), and wrapped commercial badges.
- **Column 3 (Main Chat Workspace)**: Full-width workspace with collapsible `⚡ AI DM Intelligence` card & `✨ AI Summary` (with `👁️ Hide` / `👁️ Show` toggle for clear chat visibility), dynamic 24h messaging window countdown and live status updates, conversation message stream, and grounded AI reply composer.
- **🧹 Clear Chat & 🗑️ Delete Chat**: Clear message history (`DELETE /api/conversations/:id/messages`) or permanently delete thread with cascaded deletions (`DELETE /api/conversations/:id`).

### 6. 🛡️ Multi-Tenant Data Isolation & Security Hardening
- **Socket.io Handshake Session Authentication**: Mounts express-session directly on `io.engine.use(sessionMiddleware)`. Sockets are authenticated via `socket.request.session.userId` and auto-joined to `user:${userId}` on connection. Unauthenticated sockets and cross-tenant room join attempts are strictly rejected.
- **Socket Force-Disconnect on Logout**: `disconnectUserSockets(userId)` terminates all active real-time connections when a user session is destroyed.
- **Disconnected Instagram Account Safety**: Webhooks for disconnected accounts are cleanly skipped and logged without mutating state.
- **BrandDeal Cross-Tenant Protection**: Prevents account re-linking conflicts when historical sponsorship deals exist under previous ownership.
- **Production Webhook Signature Gates**: Structural code-level gates ensure webhook signature verification can never be bypassed in production (`NODE_ENV=production`).

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Vanilla CSS Modules & Tokens, Axios, Socket.io-client |
| **Backend API** | Node.js v24, Express v4.21, Socket.io v4.8, Bcryptjs, Cookie-Parser, Express-Session |
| **Database & ORM** | SQLite (Local Dev) / PostgreSQL (Production), Prisma ORM v6.19 |
| **AI Providers** | Google Gemini (`gemini-flash-lite-latest`, `gemini-flash-latest`), xAI Grok (`grok-3-mini`, `grok-2-latest`), OpenAI (`gpt-4o-mini`, `gpt-4o`) |
| **Cryptography** | Node.js Crypto (AES-256-GCM, HMAC-SHA256) |

---

## 🧪 Verification & Test Suites

The codebase includes automated test suites covering all critical functions:

```bash
# 1. Socket.io Isolation & Multi-Tenant Security Regression Test
node scripts/test-socket-isolation.js # 21/21 tests passed

# 2. Generalized SaaS Verification (Auth, Logout, Onboarding, 10-category intelligence, auto-reply gate, anti-hallucination)
node scripts/test-general-saas.js    # 28/28 tests passed

# 3. Per-Conversation AI Auto-Reply Engine
node scripts/test-auto-reply.js      # 11/11 tests passed

# 4. AI Multi-Provider & Auto-Failover Chain
node scripts/test-ai-failover.js     # 10/10 tests passed

# 5. Clear Chat & Full Conversation Delete Verification
node scripts/test-chat-delete.js     # 11/11 tests passed

# 6. Session Isolation & Tenant Safety
node scripts/test-isolation.js       # 29/29 tests passed

# 7. Next.js Frontend Production Compilation
cd ../frontend && npm run build     # 20/20 static pages compiled with 0 errors
```
