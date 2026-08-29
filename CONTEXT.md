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
5. **BrandDeal Conflict Protection on Account Re-linking**: In `GET /auth/instagram/callback`, transferring an Instagram account to a different user is blocked with `409 Conflict` if existing `BrandDeal` rows belong to the previous owner.
6. **Production Signature Verification Gate**: `SKIP_SIGNATURE_VERIFICATION` is strictly gated by `!isProduction`. In production mode (`NODE_ENV=production`), the backend crashes with a fatal error on boot if `SKIP_SIGNATURE_VERIFICATION=true` is set.

### Application Security Hardening
Additional platform hardening across auth, session, transport, and admin surfaces (`backend/src/lib/security.js`, `backend/src/lib/rateLimit.js`):

1. **Session-only identity (no query-param auth)**: `requireAuth` and `/auth/*` derive identity **exclusively** from `req.session.userId`. A previous `?user_id=` debug fallback that let any request act as any account by id has been removed everywhere.
2. **Admin credentials from environment only**: `POST /api/admin/login` has **no hardcoded default**. It requires `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` (bcrypt, preferred) or `ADMIN_PASSWORD`, uses a constant-time comparison, is rate-limited, and returns `503` when unconfigured. First-user auto-promotion to `ADMIN` was removed.
3. **No secret leakage in responses**: Admin user endpoints (`/users`, `/users/:id`, `/support/search`, `/stats`, login) strip `passwordHash` via `sanitizeUser`. Access tokens are never returned.
4. **Strict CORS allowlist**: Credentialed cross-origin requests are honored only for `FRONTEND_URL` / `BACKEND_URL` / `ALLOWED_ORIGINS` (plus localhost in dev). Unknown origins receive no `Access-Control-Allow-Origin` header — the old reflect-any-origin behavior is gone.
5. **CSRF defense-in-depth**: `originGuard` rejects state-changing requests (`POST/PUT/PATCH/DELETE`) whose Origin/Referer is present but not allowlisted; the session cookie is `SameSite=lax` (override via `COOKIE_SAMESITE`).
6. **Security headers on every response**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security` (production).
7. **Rate limiting**: In-memory fixed-window limiter on `/auth/login`, `/auth/register`, and `/api/admin/login`; message pagination `take` is clamped to ≤ 100.
8. **Fail-closed secrets**: In production the server refuses to boot if `SESSION_SECRET` is unset/default or `INSTAGRAM_APP_SECRET` is unset. Token encryption prefers a dedicated `TOKEN_ENCRYPTION_KEY` and never derives the key from a public default in production.
9. **Webhook secret required**: Signature verification rejects requests when `INSTAGRAM_APP_SECRET` is empty instead of computing an attacker-known empty-key HMAC.

---

## 4. Conversational Intelligence & Anti-Loop Pacing

### Anti-Loop & Conversational Guards (`messageAnalysisJob.js`)
1. **Closing / Acknowledgment Filter**: Detects when customers send short ending messages (`ok`, `okay`, `k`, `thanks`, `thank you`, `got it`, `sure`, `cool`, `noted`, `will check`, `bye`) and skips auto-replying so AI never creates an annoying endless loop.
2. **Consecutive Auto-Reply Limit (Max 2 consecutive replies)**: AI will only auto-respond up to 2 times in a row without human intervention. If the conversation continues beyond that, AI steps aside, flags `needsHuman: true` and `needsAttention: true`, and alerts the business owner for personal follow-up.
3. **Daily Rate Limit (Max 3 auto-replies / 24 hours per chat)**: Caps total automated messages per conversation to 3 within any rolling 24-hour window.

---

## 5. Test Suites & Verification Results
All test suites pass 100%:
- `backend/scripts/test-socket-isolation.js`: 21/21 passed (Socket auth, room isolation, disconnected skipping, 409 re-linking, logout disconnect, production security gate)
- `backend/scripts/test-general-saas.js`: 28/28 passed
- `backend/scripts/test-auto-reply.js`: 11/11 passed
- `backend/scripts/test-ai-failover.js`: 10/10 passed
- `backend/scripts/test-chat-delete.js`: 11/11 passed
- `backend/scripts/test-isolation.js`: 29/29 passed
- `npm run build` in `frontend/`: 20/20 static routes compiled successfully with 0 errors.

---

## 6. Important Rules & Directives
- **Maintain Session & Tenant Safety**: All queries must filter by `instagramAccount: { userId: req.userId }`.
- **Session is the only identity source**: Never re-introduce a client-supplied `user_id`/id fallback for authentication — identity comes solely from `req.session.userId`.
- **No secrets in responses**: Never return `passwordHash` or decrypted access tokens from any endpoint; route new user-facing payloads through `sanitizeUser`.
- **No credential defaults**: Admin and signing/encryption secrets must come from the environment; do not add hardcoded fallbacks.
- **Grounded AI Answers**: Never remove anti-hallucination system prompt constraints.
