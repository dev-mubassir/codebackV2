# Tenant isolation audit — Gate 2b (2026-09-25)

Scope: every API route, socket handler, BullMQ job, in-process cache and log line that touches tenant data.

**Headline:** no direct cross-tenant read or write through any HTTP route. Every tenant query is scoped to `req.userId` (directly, or through `instagramAccount: { userId }`), and every ID from the URL, query or body is ownership-checked. Socket emits all go through `emitToUser(<owner>)` to room `user:<id>`, with no `io.emit` or broadcast. Job workers derive the tenant from the message itself. No cache holds tenant data under a shared key.

Findings, recorded before any fix:

| # | Area | Where | Severity | Issue | Status |
|---|---|---|---|---|---|
| F1 | Sockets | `src/index.js` socket handshake; `src/lib/sessionIdle.js` `socketSessionIsLive` | High | The handshake checked only that the session had a `userId` and wasn't idle. After a password reset or an admin suspension, the client's automatic reconnect with the old cookie was accepted, and it kept receiving DMs until the idle limit. | **Fixed.** The handshake and the 60 s socket sweep now require that the user exists, is not suspended, and has a matching `sessionVersion` (`sessionUserIsValid`). Test: `tenant-isolation-gaps.test.js`. |
| F2 | Webhook / data | `prisma/schema.prisma` `Message.igMessageId @unique`; webhook dedupe | Medium | The message-id dedupe is global across tenants. If two tenants DM each other through the app, the recipient's inbound copy can be dropped as a "duplicate" of the sender's outbound row. No data is disclosed, but a DM is missed. | **Fixed (Gate 3, approved).** Migration `20260930090000_message_id_unique_per_conversation` creates `@@unique([conversationId, igMessageId])` first, then drops the global index. The webhook dedupe is scoped to the receiving account. Test: two tenants DM each other and both store the message. |
| F3 | Data deletion | `src/routes/dataDeletion.js` `eraseInstagramUserData` | Medium | A Meta deletion callback for IG account X deletes X's rows for every owner (correct). It also deletes an **earlier** owner's whole Siffty account (login, billing) when that owner has no other IG account. | **Fixed (Gate 3, approved scope).** The callback erases only Meta-derived data (the connection, token, profile, contacts, conversations, messages, analyses, summaries, drafts, brand deals, webhook logs, and notifications pointing at them) for every tenant holding the IG account. It never deletes a Siffty login, billing or payments, or another connected account. The confirmation code and status URL are unchanged. |
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

## Legal text vs the F3 behaviour (checked 2026-09-26; not edited)

- `/data-deletion` ("Siffty automatically erases all data for that Instagram account") and `/privacy` §8 and §9 ("that account's data is erased automatically") **match**. Neither says the Siffty login is deleted by a Meta request.
- `/privacy` retention bullet "Messages, conversations, contacts, and analysis results … are erased when the owner deletes the conversation, purges the connected account, or closes their Siffty account" doesn't list the Meta deletion callback as a fourth trigger. That's an omission, not a contradiction, since §8 and §9 cover it. Optional wording for the owner to consider.
- The trial-abuse hash (`instagram_identities`) is still kept after a Meta deletion, which matches `/privacy`'s "Trial-abuse record" paragraph.
- The deletion-confirmation email's "your Siffty account was deleted too" line can no longer trigger (`accountDeleted` is always false).
