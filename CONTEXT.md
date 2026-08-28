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
- **Grounded AI Answers**: Never remove anti-hallucination system prompt constraints.
