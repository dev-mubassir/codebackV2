# Tenant isolation audit — Gate 2b (2026-09-25)

Scope: every API route, socket handler, BullMQ job, in-process cache and log line that touches tenant data.

**Headline:** no direct cross-tenant read or write through any HTTP route. Every tenant query is scoped to `req.userId` (directly, or through `instagramAccount: { userId }`), and every ID from the URL, query or body is ownership-checked. Socket emits all go through `emitToUser(<owner>)` to room `user:<id>`, with no `io.emit` or broadcast. Job workers derive the tenant from the message itself. No cache holds tenant data under a shared key.

Findings, recorded before any fix:

| # | Area | Where | Severity | Issue | Status |
|---|---|---|---|---|---|
| F1 | Sockets | `src/index.js` socket handshake; `src/lib/sessionIdle.js` `socketSessionIsLive` | High | The handshake checked only that the session had a `userId` and wasn't idle. After a password reset or an admin suspension, the client's automatic reconnect with the old cookie was accepted, and it kept receiving DMs until the idle limit. | **Fixed.** The handshake and the 60 s socket sweep now require that the user exists, is not suspended, and has a matching `sessionVersion` (`sessionUserIsValid`). Test: `tenant-isolation-gaps.test.js`. |
| F2 | Webhook / data | `prisma/schema.prisma` `Message.igMessageId @unique`; webhook dedupe | Medium | The message-id dedupe is global across tenants. If two tenants DM each other through the app, the recipient's inbound copy can be dropped as a "duplicate" of the sender's outbound row. No data is disclosed, but a DM is missed. | **Proposed, needs approval.** Replace the global unique with `@@unique([conversationId, igMessageId])` and scope the webhook check to the account. That drops a unique index, so the migration is not purely additive. |
| F3 | Data deletion | `src/routes/dataDeletion.js` `eraseInstagramUserData` | Medium | A Meta deletion callback for IG account X deletes X's rows for every owner (correct). It also deletes an **earlier** owner's whole Siffty account (login, billing) when that owner has no other IG account. | **Proposed, needs approval.** Delete the User row only for the owner of the current connected link. For earlier owners, erase X's rows only. This is a Meta-compliance behaviour change. |
| F4 | Jobs / auto-reply | `src/jobs/messageAnalysisJob.js` `maybeAutoReply` | Low–Med | The account row (and token) loaded at job start could be seconds stale. A reply could go out after the owner disconnected, or after the IG account moved to another workspace. | **Fixed.** The account is re-read (`userId` + `CONNECTED`) right before `sendMessage`; the send is aborted if it's gone. |
| F5 | Logs | `src/routes/contact.js` | Low | The enquirer's email was logged when `SUPPORT_EMAIL` was unset. | **Fixed.** No address is logged. |
| F6 | Logs | `src/lib/email/index.js` (undeliverable warning) | Low | The full recipient address was logged. | **Fixed.** Now a hashed recipient. |
| F7 | Logs | `src/routes/api.js`, webhook processing | Low | Contact IGSIDs were logged on every send, delete and incoming DM, and the raw Meta error object was logged. No DM text or tokens. | **Fixed.** Logs use internal IDs, and Meta errors are reduced to `code`/`subcode`. |

Other notes:
- The durable inbox (`webhook_deliveries.payload`) holds the raw DM until it is processed. It is cleared as soon as the DM is in the inbox, and it's only reachable by the processor and the admin backlog counts.
- `POST /auth/add-email` answers 409 "already uses that email" to a logged-in user. That's minor enumeration, left as is.

New isolation tests (`tests/tenant-isolation-gaps.test.js`, plus `socket-multi-instance.test.js`):
- Tenant B's view of every aggregate endpoint contains nothing of tenant A: `/auth/me`, dashboard and analytics summaries, auto-reply chats, draft credits, conversation, account and notification lists.
- `read-all` and `DELETE /api/accounts/:id?purge=true` can't reach another tenant.
- A webhook for an IG account that moved workspaces is stored and emitted only to the connected owner.
- F1 session validity.
- Two users on two instances: B's event never reaches A.
- The existing `tenant-isolation-idor.test.js` covers A → 404 on every `/:id` route.
