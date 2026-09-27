# Auto DM — gate log

Branch `feature/autodm` (from origin/master @051f9d7). Local commits only; never pushed.
Baseline (Gate 0, on code identical to origin/master): 71 files (70 passed, 1 skipped), 806 tests: 794 passed, 12 skipped, 0 failed.

---

## Gate 1 — schema, migration, config, status route

**Built**
- `backend/prisma/schema.prisma`: 4 new models — `AutoDmAccountState`, `AutoDmAutomation`, `AutoDmRun`, `AutoDmImage` (tables `autodm_*`).
- `backend/prisma/migrations/20261001090000_autodm/migration.sql`: CREATE TABLE ×4, CREATE INDEX ×13 (4 unique), FOREIGN KEY ×9 — all FKs are on the new tables, referencing `users`, `instagram_accounts` and each other, all `ON DELETE CASCADE`. Checked by a grep that fails on any other statement type: none found. Applied to the local dev DB (`localhost:55432/codeback`) and the test DB (`codeback_test`) only.
- `backend/src/features/autodm/`: `config.js` (AUTODM_ENABLED, AUTODM_SCOPE_ALLOWLIST, AUTODM_SCOPE_ALL, AUTODM_POLL_FALLBACK), `log.js`, `routes.js` (`GET /api/autodm/status` + the disabled gate), `publicRoutes.js` (empty until Gate 2), `index.js` (the only entry point).
- `backend/tests/autodm-status.test.js` (new, 8 tests).

**Existing files touched**
| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | +138 lines, 0 removed: back-relation fields on `User` (4) and `InstagramAccount` (3) — no columns — and the 4 new models appended at the end. |
| `backend/src/index.js` | +5 lines after the `/data-deletion` mount: comment + `app.use('/public/autodm', …publicRouter)` + `app.use('/api/autodm', …apiRouter, notFoundHandler)`. |

**Tests**: `autodm-status.test.js` 8/8 passed. Full suite runs at Gates 2 and 4.

**Security checks**
- Status route needs a session; no Auto DM DB query anywhere yet.
- All other routes 404 when off or when the user is not allowlisted.
- Per-user rate limiter on the whole router.
- Migration: additive only; no existing table altered.

**Risks**: none new. FK creation briefly locks `users` / `instagram_accounts` at deploy (empty new tables, instant).

---

## Gate 2 — backend (OpenReply addendum folded in; Gate 2 was not yet committed)

**Postbacks before this gate (logged first, per the addendum).** `processEntry` walks `entry.messaging[]` with `if (message) … else if (read) … else if (reaction) …`. A postback event matches none of them and is silently ignored (not stored, not classified); the entry still writes its usual `WebhookLog` row (`eventType: 'messaging'`, SUCCESS). `messaging_postbacks` is not in `subscribed_fields`, so none are delivered today anyway.

**Built** (`backend/src/features/autodm/`)
- `intake.js` — comment normaliser (`id ?? comment_id`, `media.id ?? media_id`, `original_media_id`), self/too-old/no-match/duplicate rules, `intakeComment()` shared by webhook and poller, comment-only entry/delivery detection, `handleCommentEntry()`.
- `matcher.js` — OpenReply keyword pipeline + Devanagari-strict boundaries + emoji keywords; automation selection (SPECIFIC > ANY > newest; boosted-post match).
- `worker.js` — DB queue loop (`FOR UPDATE SKIP LOCKED` claim, 5-min lease), opener (public reply at-most-once, button template with one postback, plain-text retry), follow gate (3 checks, fail-open on unknown), main message (image once, web_url button, text+link fallback), backoff (5 attempts), rate-limit backoff, 700/h throttle with requeue, 7-day expiry, dead-token handling.
- `interaction.js` — postback handler + messaging seam (quick_reply payload or LINK keyword); run claim + `aiStatus:'autodm'` in one transaction; spoof → false.
- `poller.js` — AUTODM_POLL_MODE, 2-min sweep, 72h lookback (not before the automation's last save), ≤30/automation/sweep, 368 backoff.
- `graph.js` — every Graph call (button templates, follow status → true/false/null, media, comments, extended subscribe); safe error codes only.
- `routes.js` — accounts, media list, automation CRUD, status toggle, run log (last 50), image upload; `publicRoutes.js` — image serving.
- `images.js`, `cleanup.js`, `connect.js`, `events.js` (`autodm:run_created`, `autodm:run_updated`), `validation.js`, `messages.js`, `util.js`, `config.js` (AUTODM_POLL_MODE replaces AUTODM_POLL_FALLBACK).
- `THIRD_PARTY_NOTICES.md` (repo root): full MIT text, both copyright lines, file map.
- Tests (new): `tests/autodm-matcher.test.js` (25, ported + Devanagari/Hinglish), `tests/autodm-flow.test.js` (4), `tests/helpers/autodm.js` (new helper); `tests/autodm-status.test.js` updated for AUTODM_POLL_MODE (our own Gate 1 file).

**Existing files touched (cumulative vs origin/master)**
| File | Change | Diff |
|---|---|---|
| `backend/src/services/metaWebhookProcessor.js` | `require('../features/autodm')`; comment-only entry branch at the top of `processEntry` (returns before the DM path and before any WebhookLog write; retries only a comments-only delivery); postback branch LAST in the messaging `else if` chain (AUTODM: payloads only); the one seam line between the `new_message` emit and the classification enqueue. | +16 / −0 |
| `backend/src/jobs/index.js` | `startLoop()` inside `startWorkers`' once-only block; `await stopLoop()` first in `stopWorkers`; one `JOBS` entry `autodm_cleanup` (6h). | +7 / −0 |
| `backend/src/lib/instagram.js` | `getAuthorizationUrl(…, { extraScopes = [] } = {})`; scopes = REQUIRED_SCOPES + extras. Verified byte-identical to origin/master's output when no options are passed. | +5 / −2 |
| `backend/src/routes/auth.js` | `require('../features/autodm')`; 4th argument `autodm.connectScopeOptions(user.email)` at the `getAuthorizationUrl` call (undefined unless allowlisted); `autodm.afterInstagramConnect(…)` right after the existing subscribe try/catch (never throws). | +13 / −1 |
| `backend/src/index.js` | (Gate 1) 2 `app.use` mounts. | +5 / −0 |
| `backend/prisma/schema.prisma` | (Gate 1) back-relations + 4 models. | +138 / −0 |

**Tests** — full suite on codeback_test: **74 files (73 passed, 1 skipped); 843 tests: 831 passed, 12 skipped, 0 failed.** Baseline 806/794/12/0 → all 794 baseline passes still pass, the same 12 skipped, +37 new Auto DM tests. Zero edits to existing tests.

**Security checklist**
- Tenant isolation: every route filters by `req.userId` (+ owned account ids); intake resolves the account from `entry.id` (CONNECTED only) and loads only that account+owner's automations; the worker refuses a run whose account/automation owner differs (`TENANT_MISMATCH`); taps require run ∈ entry.id's account AND sender = run.igsid. Cross-tenant ids → 404. ✔
- Untrusted input: comment/sender/media ids shape-checked (`ID_RE`), texts truncated, postback payload strict regex (UUID + GET|FOLLOWED), zod `.strict()` bodies. ✔
- Ids: runs, automations, images use `crypto.randomUUID()`. ✔
- Validation limits: name 60; keywords ≤30×50; opener/follow prompt ≤640 chars & ≤1000 bytes; main ≤640 with link else ≤900, ≤1000 bytes; labels ≤20; public replies ≤3×300; https-only link with a real domain (no http/javascript/data/credentials/IP/localhost). ✔
- Uploads: magic bytes JPG/PNG only (SVG/GIF/fake → 415), ≤2 MB (413), route-level raw parser, served with exact Content-Type, nosniff, inline disposition, cache headers, 404 once detached/deleted, IP rate limit. ✔
- No SSRF: the server never fetches a user-supplied URL (links go to Meta as button URLs; the image URL is our own). ✔
- Tokens only via `readAccountToken`; logs carry `[autodm]`, ids, statuses and safe codes — no tokens, payloads or comment/message text. ✔
- Raw Graph errors never reach the client (fixed messages; `lastError` stores codes like `META_100`). ✔
- Throttle < 750 private replies/hour/account (700, overflow re-queued); `createRateLimiter` on `/api/autodm` (120/min/user). ✔
- AUTODM_ENABLED=false → the seam, the postback branch and comment intake return before any Auto DM DB query; the loop idles. ✔
- Frontend items: Gate 3.

**Risks**
- `messaging_postbacks` may need enabling at app level in the Meta dashboard (human step); if taps never arrive, the LINK keyword still works.
- If the opener send times out after Meta actually delivered it, retries hit Meta's one-private-reply rule and the run ends FAILED (the person got the opener; a tap then falls to normal sorting). OpenReply has the same class of ambiguity.
- An admin "re-subscribe webhooks" action (routes/admin.js, untouched) sends the base fields only and would drop `comments` for an allowlisted account until its next connect.
- The poller reads only top-level comments and assumes the comment `from` field is returned for Instagram Login tokens (assumed from Meta docs; the webhook path does not depend on it).
