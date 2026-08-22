# Codeback — Generalized AI Instagram DM Customer Intelligence & Sales SaaS

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=nextdotjs)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.19-2D3748?logo=prisma)](https://www.prisma.io/)
[![Multi-Provider AI](https://img.shields.io/badge/AI-Gemini%20%7C%20xAI%20Grok%20%7C%20OpenAI-8E7CC3)](https://ai.google.dev/)
[![Security](https://img.shields.io/badge/Security-AES--256--GCM-success)](https://nodejs.org/api/crypto.html)

**Codeback** is a generalized, high-performance Instagram DM Customer Intelligence, Lead Qualification, Sales & Support SaaS. Built for **Video & Photo Editors, Product Sellers, Used Phone/Laptop Sellers, Clothing & Fashion Boutiques, Agencies, Freelancers, Coaches, E-commerce, and Content Creators**.

Codeback syncs incoming Direct Messages via signature-verified Meta webhooks, qualifies hot commercial leads, detects security threats and scams, extracts sponsorship deals, and provides an **intelligent multi-stage auto-reply engine grounded in your real Business Knowledge Base** — with zero hallucination.

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
│ SQLite / Postgres (Prisma ORM)       │ │ Resilient Multi-Provider AI Engine                      │
│ • Persistent Business Profile Context│ │ • Keyword Pre-filter (0ms)                              │
│ • AES-256-GCM Encrypted IG Tokens    │ │ • Gemini ⟷ xAI Grok ⟷ OpenAI                            │
│ • Strict Tenant & Session Isolation  │ │ • Multi-Stage Auto-Reply Gate                           │
│ • Cascading Message/Account Deletion │ │ • Anti-Hallucination Grounding (BusinessProfile)        │
└──────────────────────────────────────┘ └─────────────────────────────────────────────────────────┘
```

---

## ✨ Core SaaS Features

### 1. 🔐 Email & Password Authentication + Dynamic Onboarding
- **Independent Application Auth**: Standard signup, login, and robust session termination (`POST /auth/logout`) with `bcryptjs` password hashing and secure session cookies (`codeback.sid`).
- **Interactive Onboarding Wizard (`/onboarding`)**: 3-step setup with pre-filled, production-ready knowledge templates for 12 business categories (Video Editor, Used Devices, Clothing Boutique, Freelancer, Agency, Coach, Creator, Photo Editor, Graphic Designer, Product Seller, Local Business, E-commerce), plus a clean custom template for `other`.
- **Persistent Business Profile (`BusinessProfile`)**: Ground-truth context storing business name, categories, products/services, pricing rates, turnaround times, shipping coverage, payment methods, FAQs, and tone.

### 2. 🎯 Generalized AI DM Intelligence & Lead Qualification
- **Broad Intent Classification**: Accurately classifies `product_inquiry`, `service_inquiry`, `pricing_inquiry`, `availability_inquiry`, `delivery_inquiry`, `hot_lead`, `lead`, `customer`, `support_request`, `general_question`, `brand_deal`, `collaboration`, `fan`, `spam`, `scam`, and `abusive`.
- **Commercial Lead Scoring (0-100)**: Evaluates `purchaseIntent` and `leadQuality` to automatically prioritize paying customers at the top of the inbox.
- **Scam & Risk Gatekeeper**: Evaluates `riskLevel` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) and `scamProbability` (0-100%) for phishing links, OTP requests, and fake payment receipts.

### 3. ⚡ Intelligent Multi-Stage Auto-Reply Safety Gate
- **Granular Per-Conversation Control**: Auto-reply is toggled on a per-chat basis so you stay in total control.
- **Multi-Stage Decision Model**:
  - *Stage 1*: Check business profile automation mode (`smart`, `suggest_only`, `human_only`).
  - *Stage 2*: Check 24-hour Meta messaging window.
  - *Stage 3*: Multi-risk safety checks (blocks scams, spam, abusive messages, angry disputes, and missing business facts).
  - *Stage 4*: Confidence threshold gating (`confidence >= 75%`).
- **Strict Anti-Hallucination Grounding**: AI replies strictly quote prices, turnaround times, and policies defined in your `BusinessProfile` — never inventing arbitrary discounts or fake dates.

### 4. 📥 3-Column Structured Inbox & Smart CRM (`/inbox`)
- **Column 1 (Dedicated Filter Sidebar)**: Vertically stacks Connected Accounts and Smart Inbox Folders (`All`, `Unread`, `Important`, `Hot Leads`, `Leads & Inquiries`, `Customers`, `Questions`, `Support`, `Needs Human`, `Spam & Scams`) plus a bottom-left user Profile link.
- **Column 2 (Squeezed Conversation List Panel)**: 300px min-width list showing contact avatar, 24h window radar dot, name & timestamp pushed to opposite ends, single-line ellipsis message preview (`white-space: nowrap`), and wrapped compact badges.
- **Column 3 (Main Chat Workspace)**: Full-width workspace with collapsible `⚡ AI DM Intelligence` card & `✨ AI Summary` (with `👁️ Hide` / `👁️ Show` toggle for clear chat visibility), 24h window countdown, conversation message stream, and grounded AI reply composer.
- **🧹 Clear Chat**: Clears message history for a conversation thread (`DELETE /api/conversations/:id/messages`) while keeping contact profile and automation rules.
- **🗑️ Full Chat Delete**: Permanently removes the conversation and cascades related messages, analyses, and brand deal extractions (`DELETE /api/conversations/:id`).

### 5. 👤 Profile Management & Account Deletion (`/profile`)
- **Profile Navigation**: Instant access from the bottom-left corner of sidebars and top-right corner of header navigation bars.
- **User & Security Management**: Edit user display name and securely change account password.
- **Connected Accounts & Knowledge Base Snapshot**: Real-time view of connected Instagram accounts and AI business profile.
- **⚠️ Danger Zone (Account Deletion)**: Full permanent account wipe (`DELETE /auth/account`) with confirmation modal requiring the user to type `DELETE`.

### 6. 🔄 Multi-Provider AI Auto-Failover Chain
- **Zero-Downtime AI Resilience**: Seamless failover chain across **Google Gemini**, **xAI Grok**, and **OpenAI**.
- **Instant Shift on Errors**: Automatically routes requests to the next active provider if rate limits, quota limits, or network errors occur.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Vanilla CSS Modules & Tokens, Axios, Socket.io-client |
| **Backend API** | Node.js v24, Express v4.21, Socket.io v4.8, Bcryptjs, Cookie-Parser, Express-Session |
| **Database & ORM** | SQLite (Local Dev) / PostgreSQL (Production), Prisma ORM v6.19 |
| **AI Providers** | Google Gemini (`gemini-flash-latest`), xAI Grok (`grok-3-mini`, `grok-2-latest`), OpenAI (`gpt-4o-mini`, `gpt-4o`) |
| **Cryptography** | Node.js Crypto (AES-256-GCM, HMAC-SHA256) |

---

## 🧪 Verification & Test Suites

The codebase includes automated test suites covering all critical functions:

```bash
# 1. Generalized SaaS Verification (Auth, Logout, Onboarding, 10-category intelligence, auto-reply gate, anti-hallucination)
node scripts/test-general-saas.js    # 28/28 tests passed

# 2. Clear Chat & Full Conversation Delete Verification
node scripts/test-chat-delete.js     # 11/11 tests passed

# 3. Session Isolation & Tenant Safety
node scripts/test-isolation.js       # 29/29 tests passed

# 4. AI Multi-Provider & Auto-Failover
node scripts/test-ai-failover.js     # 10/10 tests passed

# 5. Per-Conversation AI Auto-Reply Engine
node scripts/test-auto-reply.js      # 11/11 tests passed

# 6. Next.js Frontend Production Compilation
cd ../frontend && npm run build     # 20/20 static pages compiled in 6.4s (0 errors)
```
