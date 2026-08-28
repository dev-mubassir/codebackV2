# Codeback Backend Multi-Tenant Data Isolation Audit Report

**Date:** 2026-08-28  
**Scope:** Node.js/Express, Prisma ORM, Socket.io, Meta Webhooks, AI Pipeline  
**Objective:** Audit and verify data isolation across all tenant-scoped boundaries and identify any cross-tenant data leakage risks.

---

## Executive Summary

| Area | Status | Key Findings |
|---|---|---|
| **Priority 1 — Webhook → Account Mapping** | ⚠️ Review Required | HMAC signature runs first, `igUserId` is globally unique. Need design decision on handling disconnected accounts & account reassignment for `BrandDeal.userId`. |
| **Priority 2 — Session & Cookie Isolation** | ⚠️ Hardening Rec | Sessions use `codeback.sid` with `httpOnly: true`, `secure: isProduction`. Session secret fallback & MemoryStore should be hardened for clustered prod. |
| **Priority 3 — Full Prisma Query Sweep** | ✅ Verified Safe | 100% of tenant-scoped queries (`Conversation`, `Message`, `InstagramAccount`, `BrandDeal`, etc.) verify ownership via `req.userId`. |
| **Priority 4 — Socket.io Room Scoping** | 🚨 Bug Found | Socket room joining had fallback allowing unauthenticated room joins (`user:${userId}`). |
| **Priority 5 — AI Context & Race Conditions** | ✅ Verified Safe | Gemini/AI prompts are constructed per-request with zero module-level leaks. Database schema has strict `@unique` constraints. |

---

## Detailed Findings by Priority

### PRIORITY 1 — Webhook → Account Mapping (High Risk, No Session Context)

#### 1. Incoming DM Tenant Resolution
- **Payload Field**: Meta delivers the Instagram Professional Account ID in `entry.id`.
- **Lookup Query**: [backend/src/routes/webhook.js](file:///c:/codeback/backend/src/routes/webhook.js#L115-L118)
  ```javascript
  const igUserId = String(entry.id);
  const account = await prisma.instagramAccount.findUnique({
    where: { igUserId: igUserId },
    include: { user: true },
  });
  ```
  The internal tenant is strictly resolved through `account.userId`.
- **Background Worker**: In [backend/src/jobs/messageAnalysisJob.js](file:///c:/codeback/backend/src/jobs/messageAnalysisJob.js#L107-L128), messages are fetched by `messageId` and ownership is resolved via:
  ```javascript
  const userId = conversation.instagramAccount.userId;
  ```

#### 2. Ambiguity & Uniqueness Check
- ✅ **Verified Safe**: [backend/prisma/schema.prisma](file:///c:/codeback/backend/prisma/schema.prisma#L98) enforces a database-level `@unique` constraint:
  ```prisma
  igUserId String @unique @map("ig_user_id")
  ```
  Two `InstagramAccount` rows cannot coexist with the same `igUserId`.

#### 3. Mid-Linking / Unmapped Webhooks
- ✅ **Verified Safe**: If an unmapped `igUserId` arrives, [backend/src/routes/webhook.js](file:///c:/codeback/backend/src/routes/webhook.js#L120-L135) logs an unmapped event to `WebhookLog` with `status: 'SKIPPED'` and terminates immediately without routing to any default tenant.

#### 4. Signature Verification Order
- ✅ **Verified Safe**: In [backend/src/routes/webhook.js](file:///c:/codeback/backend/src/routes/webhook.js#L48-L55), HMAC signature verification (`x-hub-signature-256`) executes over `req.rawBody` **before** any database reads or writes using `crypto.timingSafeEqual`.

#### 5. In-Memory Cache Check
- ✅ **Verified Safe**: No module-level `Map`, cache, or singleton holds `igUserId → userId` mappings. Every webhook resolves against the database.

#### 6. ⚠️ Design Decisions Needed
1. **Disconnected Accounts**: In [backend/src/routes/webhook.js](file:///c:/codeback/backend/src/routes/webhook.js#L115-L135), webhooks are currently processed even if `account.connectionStatus === 'DISCONNECTED'`.
2. **Account Re-linking**: In [backend/src/routes/auth.js](file:///c:/codeback/backend/src/routes/auth.js#L261-L287), if User B connects an IG account previously owned by User A, `account.userId` updates to User B, but existing `BrandDeal` rows retain `userId: User A` because `BrandDeal` stores a redundant `userId` column.

---

### PRIORITY 2 — Session / Cookie Isolation

#### 1. Session Store
- ⚠️ **Needs Hardening**: [backend/src/index.js](file:///c:/codeback/backend/src/index.js#L99-L110) uses the default in-memory `MemoryStore`. While functional for single-instance dev, multi-instance production deployments require a centralized store (e.g., Redis or database-backed).

#### 2. Session Secret
- ⚠️ **Recommendation**: In [backend/src/index.js](file:///c:/codeback/backend/src/index.js#L94-L101), missing `SESSION_SECRET` in production logs a warning but falls back to `'codeback-dev-secret-change-in-production'`. In production, the server should throw a fatal error on boot if `SESSION_SECRET` is unset.

#### 3. Cookie Configuration
- ✅ **Verified Safe**:
  - `name: 'codeback.sid'`
  - `httpOnly: true`
  - `secure: isProduction`
  - `sameSite: isProduction ? 'none' : 'lax'`

#### 4. Logout Handling
- ✅ **Verified Safe**: [backend/src/routes/auth.js](file:///c:/codeback/backend/src/routes/auth.js#L187-L200) calls `req.session.destroy()` server-side and clears the cookie via `res.clearCookie('codeback.sid')`.

#### 5. Authenticated Route Tenant Derivation
- ✅ **Verified Safe**: [backend/src/middleware/auth.js](file:///c:/codeback/backend/src/middleware/auth.js#L12-L35) derives `req.userId` strictly from `req.session.userId`. The `?user_id=` debug override is hard-disabled in production (`!isProduction`).

---

### PRIORITY 3 — Full Prisma Query Sweep

Every database query touching tenant models was inspected:

| Route / File | Operation | Ownership Filter | Status |
|---|---|---|---|
| `GET /api/conversations` ([api.js:99](file:///c:/codeback/backend/src/routes/api.js#L99)) | `findMany` | `where: { instagramAccountId: { in: targetAccountIds } }` | ✅ Safe |
| `GET /api/conversations/:id/messages` ([api.js:180](file:///c:/codeback/backend/src/routes/api.js#L180)) | `findFirst` | `where: { id, instagramAccount: { userId: req.userId } }` | ✅ Safe |
| `POST /api/conversations/:id/read` ([api.js:246](file:///c:/codeback/backend/src/routes/api.js#L246)) | `findFirst` / `update` | Verified ownership before update | ✅ Safe |
| `PATCH /api/conversations/:id/auto-reply` ([api.js:274](file:///c:/codeback/backend/src/routes/api.js#L274)) | `findFirst` / `update` | Verified ownership before update | ✅ Safe |
| `DELETE /api/conversations/:id/messages` ([api.js:321](file:///c:/codeback/backend/src/routes/api.js#L321)) | `findFirst` / `deleteMany` | Verified ownership before message deletion | ✅ Safe |
| `DELETE /api/conversations/:id` ([api.js:373](file:///c:/codeback/backend/src/routes/api.js#L373)) | `findFirst` / `delete` | Verified ownership before cascading deletion | ✅ Safe |
| `GET /api/conversations/:id/ai-analysis` ([api.js:410](file:///c:/codeback/backend/src/routes/api.js#L410)) | `findFirst` | `where: { id, instagramAccount: { userId: req.userId } }` | ✅ Safe |
| `POST /api/conversations/:id/generate-reply` ([api.js:450](file:///c:/codeback/backend/src/routes/api.js#L450)) | `findFirst` | Verified ownership, saved with `userId: req.userId` | ✅ Safe |
| `POST /api/conversations/:id/reply` ([api.js:516](file:///c:/codeback/backend/src/routes/api.js#L516)) | `findFirst` | Strictly verified `instagramAccount: { userId: req.userId }` | ✅ Safe |
| `GET /api/accounts` ([accounts.js:29](file:///c:/codeback/backend/src/routes/accounts.js#L29)) | `findMany` | `where: { userId: req.userId }` | ✅ Safe |
| `DELETE /api/accounts/:id` ([accounts.js:73](file:///c:/codeback/backend/src/routes/accounts.js#L73)) | `findFirst` | `where: { id, userId: req.userId }` | ✅ Safe |
| `GET /api/brand-deals` ([brandDeals.js:20](file:///c:/codeback/backend/src/routes/brandDeals.js#L20)) | `findMany` | `where: { userId: req.userId }` | ✅ Safe |
| `GET /api/brand-deals/:id` ([brandDeals.js:52](file:///c:/codeback/backend/src/routes/brandDeals.js#L52)) | `findFirst` | `where: { id, userId: req.userId }` | ✅ Safe |
| `PATCH /api/brand-deals/:id` ([brandDeals.js:81](file:///c:/codeback/backend/src/routes/brandDeals.js#L81)) | `findFirst` / `update` | `where: { id, userId: req.userId }` | ✅ Safe |
| `GET /api/notifications` ([notifications.js:21](file:///c:/codeback/backend/src/routes/notifications.js#L21)) | `findMany` | `where: { userId: req.userId }` | ✅ Safe |
| `GET/PUT /api/settings/*` ([settings.js](file:///c:/codeback/backend/src/routes/settings.js)) | `findUnique` / `update` | `where: { userId: req.userId }` | ✅ Safe |
| `GET /api/dashboard/summary` ([dashboard.js:24](file:///c:/codeback/backend/src/routes/dashboard.js#L24)) | Multi-query | Scoped to `instagramAccountId: { in: ownedAccountIds }` | ✅ Safe |

---

### PRIORITY 4 — Socket.io Room Scoping

🚨 **Vulnerability Identified**
- **File**: [backend/src/index.js:164-208](file:///c:/codeback/backend/src/index.js#L164-L208)
- **Root Cause**:
  1. The socket connection handler attempts to inspect `socket.request?.sessionStore` or `socket.handshake?.sessionStore`, but `express-session` middleware is not mounted on the Socket.io engine.
  2. As a result, session validation fails and execution falls through to the permissive fallback on line 206:
     ```javascript
     // Fallback: if session store is unavailable ... allow the join but log it.
     socket.join(`user:${userId}`);
     ```
  3. Additionally, line 184 explicitly joins on error:
     ```javascript
     if (err || !sessionData) {
       socket.join(`user:${userId}`);
       return;
     }
     ```
- **Impact**: Any connected WebSocket client could send `socket.emit('join', { userId: '<targetUserId>' })` and intercept real-time incoming messages, contacts, notifications, and AI analysis events of other users.
- **Remediation**:
  1. Share the Express session middleware with Socket.io using `io.engine.use(sessionMiddleware)` or cookie-parsing session authentication middleware.
  2. Automatically bind connected sockets to `user:${authenticatedUserId}` from the verified server session.
  3. Disallow client-emitted `join` events from specifying arbitrary `userId` targets.

---

### PRIORITY 5 — AI Context & Race Conditions

#### 1. AI Prompt State & Isolation
- ✅ **Verified Safe**: In [backend/src/services/aiService.js](file:///c:/codeback/backend/src/services/aiService.js), all functions (`analyzeConversation`, `generateReply`, `summarizeConversation`) receive business profiles, preferences, and chat history as explicit arguments. Context strings and prompts are locally scoped with no module-level global variables or shared memory leaks.

#### 2. Database Unique Constraints
- ✅ **Verified Safe**: [backend/prisma/schema.prisma](file:///c:/codeback/backend/prisma/schema.prisma) defines strict unique constraints:
  - `InstagramAccount`: `igUserId` (`@unique`)
  - `Contact`: `@@unique([instagramAccountId, igsid])`
  - `Conversation`: `@@unique([instagramAccountId, contactId])`
  - `Message`: `igMessageId` (`@unique`)
  - `BusinessProfile`: `userId` (`@unique`)
  - `CreatorPreference`: `userId` (`@unique`)
  - `Subscription`: `userId` (`@unique`)
  - `ConversationSummary`: `conversationId` (`@unique`)

---

## Action Plan & Recommendations

1. **Fix Socket.io Room Authentication (Immediate)**:
   - Mount express-session on Socket.io.
   - Restrict socket rooms strictly to verified session user IDs.
2. **Handle Account Re-linking Edge Cases**:
   - Update `BrandDeal` rows on account transfer or re-scope queries to `instagramAccount.userId`.
   - Decide whether webhooks for `DISCONNECTED` accounts should be processed or skipped.
3. **Production Session Store**:
   - Configure Redis-backed session store when running multi-instance production servers.
