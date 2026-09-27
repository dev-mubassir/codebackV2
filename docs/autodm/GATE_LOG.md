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

---

## Gate 3 — frontend

**Built**
- `frontend/src/app/autodm/` — `layout.js` (metadata), `page.js` (list), `new/page.js`, `edit/page.js`, `runs/page.js`.
- `frontend/src/app/components/autodm/` — `AutomationWizard.js`, `DmPreview.js`, `useAutoDmStatus.js`, `useAutoDmPage.js`, `copy.js`, `autodm.module.css`.
- `frontend/src/lib/autodmApi.js` — Auto DM calls on the existing axios instance.

**Screens**
1. **Sidebar** — "Auto DM" under Messaging (after Notifications), shown only when GET /api/autodm/status says enabled + available; hidden on any error.
2. **List (`/autodm`)** — subtitle; account picker when there is more than one connected account; one row per automation: name, post scope ("Any post" / "N selected posts"), trigger ("Any comment" / "Keywords: …"), Active/Paused toggle, five counts (Matched, DMs sent, Delivered, Waiting for follow, Failed), Run log / Edit / Delete (delete asks in a modal). "Create automation" in the top bar. Empty state: "No automations yet" + Create automation. Counts refresh live over Socket.io.
3. **Reconnect state** — an account without the comments scope shows "Reconnect Instagram to enable Auto DM" with a button to the existing OAuth start (no builder, no create button). No connected account → "Connect Instagram first". Not allowlisted / feature off → "Auto DM is not available on your account yet".
4. **Wizard (`/autodm/new`, `/autodm/edit`)** — step pills 1 Post · 2 Trigger · 3 Message · 4 Options (later steps unlock as you go; all open when editing). Post: name + Any post / Specific posts (grid of recent posts and reels from Instagram, multi-select). Trigger: Any comment / Keywords + exclude words. Message: first message (640 counter, "reply LINK" hint), button label, reply keyword, message with the link (640/900 counter), image upload (JPG/PNG ≤2 MB), link + button label. Options: follow gate (prompt, button label, final message), public replies (up to 3). Ends with **Save & activate** (new) or **Save changes** (edit). Live DM preview on the right (stacks below on narrow screens): opener bubble with its button, the tap, the follow prompt when on, the image, the link message with its button, and the desktop keyword note.
5. **Run log (`/autodm/runs`)** — last 50 runs: commenter, comment (with "found by polling" when applicable), status badge (Queued, DM sent, Waiting for follow, Delivered, Not following, Failed, Expired) with a plain-language note (e.g. FAIL_OPEN, refused codes), what was sent (public reply, first DM, follow checks, image, link message), time. Refresh button + live refresh.

**Existing files touched**
| File | Change | Diff |
|---|---|---|
| `frontend/src/app/components/navItems.js` | `autodmEnabled` option + one conditional item `{ 'Auto DM', '/autodm', icon: 'send' }` | +4 / −1 |
| `frontend/src/app/components/ui/AppShell.js` | import `useAutoDmStatus`; pass `autodmEnabled` to `buildNavItems` | +4 / −1 |

**Checks** — `npm run lint`: 0 errors (the 24 warnings are all pre-existing `<img>` warnings in the landing page; new files have none). `npm run build`: passes; the four routes prerender. Browser check on an isolated local preview at 1100px, 711px and 375px: list, reconnect state, wizard (validation errors, Hindi keyword + text, `javascript:` link rejected, follow-gate fields, Save & activate creating a real row), edit prefill, run log, pause toggle, delete modal; no horizontal overflow at 375px; `[autodm]` server logs carried ids/statuses only.

**Security checks** — no `dangerouslySetInnerHTML`; all user/comment text rendered as React text; images are our own public route or Instagram's CDN thumbnails from the media API (https-only filtered server-side); links are never rendered as clickable anchors in the app (preview shows the label only); server messages shown as plain text.

**Risks** — button templates may not render on Instagram desktop; the wizard says so and the reply keyword covers it.

---

## Gate 4 — tests

**New test files** (all under `backend/tests/`; no existing test or helper edited — `git diff --name-status origin/master -- backend/tests` shows only `A` lines)
| File | Tests | Covers |
|---|---|---|
| `autodm-matcher.test.js` | 25 | OpenReply's matcher cases (ported) + Devanagari, Hinglish, emoji, full-width; selection rules |
| `autodm-intake.test.js` | 21 | keyword match / no match / exclude; SPECIFIC > ANY; paused; self-comments by id and username; duplicate webhook = one run + one DM; same commenter twice = one run; bad payload shape; disconnected account; 7-day window (intake + EXPIRED); kill switch (no Auto DM query, no claim SQL, no Meta call; seam classifies normally); WebhookLog skipped for comment-only entries; comments-only delivery retried and then creates the run; mixed delivery swallows; poller+webhook in both orders = one run; poller never before the automation's save, cap 30; allowlist mode; 368 pause |
| `autodm-interaction.test.js` | 18 | follow gate: follows / not following → prompt → follows / 3 failures → final message, no link / FAIL_OPEN / LINK while waiting; spoofs: another tenant's run id (quick reply + postback) and wrong sender ignored AND the DM still classified; malformed payload; LINK with no run; double tap sends once; other postbacks unchanged; image then text, template rejected → text+link; image not resent on retry; public reply at most once and non-blocking; backoff → FAILED after 5 with a safe code; dead token → FAILED + account flagged; hourly cap re-queues; disconnected account |
| `autodm-api.test.js` | 32 | CRUD end to end; RECONNECT_REQUIRED; Meta errors never passed through; 21 validation-limit rejections; Hindi within limits accepted; cross-tenant read/update/toggle/delete/run log/media/account/image all 404/400; no moving accounts; uploads (PNG, JPEG ok; SVG, GIF, fake PNG → 415; >2 MB → 413); public image only while attached, strict headers, 404 after delete; image replace deletes the old; retention (90-day runs, orphan uploads, disconnected + moved accounts); purge/user-delete cascade |
| `autodm-connect.test.js` | 6 | non-allowlisted (feature on) and allowlisted-with-feature-off: authorize URL and subscribed_fields byte-identical, no Auto DM row; allowlisted: comments scope + second subscribe; declined scope; unreported scopes with postbacks refused → retried; everything refused → connect still succeeds |
| `autodm-regression.test.js` | 3 | a normal DM: identical classification + auto-reply outcome with the flag off and on; a mid-flow commenter's ordinary question and a stray "LINK" are still sorted |
| `autodm-aistatus.test.js` | 4 | `aiStatus:'autodm'` ignored by the orphan re-queue, the stalled sweep, skipped-message recovery, the billing unsorted count and the dashboard reviewed count |
| `autodm-status.test.js`, `autodm-flow.test.js` | 8 + 4 | (Gates 1–2) flags, status route, end-to-end happy path |

**Full suite** on codeback_test: **80 files (79 passed, 1 skipped); 927 tests: 915 passed, 12 skipped, 0 failed.** Baseline 806 / 794 passed / 12 skipped / 0 failed → every baseline test still passes, the same 12 are skipped, +121 new Auto DM tests.

**Manual test script**: `docs/autodm/MANUAL_TEST.md` (connect with the comments scope, keyword → opener → tap → link on a phone, no-match/exclude/duplicate/self, desktop LINK fallback, follow gate both paths and 3 failures, sorting unchanged, poller fallback with the tunnel stopped, kill switch, clean up).

**Security checklist** — re-verified by the tests above (tenant isolation, spoofed taps, validation limits, upload types/sizes/headers, Meta errors not leaked, kill switch inert).

**Risks** — unchanged from Gate 2/3. The manual test is the only place Meta's real behaviour (postback delivery with our field set, desktop rendering, `recipient_id`) is proven.

---

## Gate 5 — legal pages and landing

**Existing files touched**
| File | Change | Diff |
|---|---|---|
| `frontend/src/app/privacy/page.js` | Auto DM disclosures in §1, §3, §4, §6, §8 (incl. "within 24 hours of disconnecting"), §9; never-sold callout covers comment data; last updated 27 Sep 2026 | +51 / −13 |
| `frontend/src/app/terms/page.js` | new §5 Auto DM (ownership, Community Guidelines + Meta Platform Terms, no spam/misleading links, Siffty may pause); §2 mention; later sections renumbered 6–14; last updated 27 Sep 2026 | +72 / −29 |
| `frontend/src/app/data-deletion/page.js` | Auto DM automations/images/run logs in "what gets deleted"; disconnect exception; last updated | +4 / −1 |
| `frontend/src/app/page.js` | one Auto DM section (3 steps, rolling-out note) + one FAQ entry "What is Auto DM?" | +46 / −0 |
| `frontend/src/app/landing.css` | `.autodm-*` styles only (flat, 1px borders, Royal Blue accent, no gradient/shadow) | +58 / −0 |

**Checks** — `npm run lint`: 0 errors; `npm run build`: passes; backend tests that read these pages (`landing-pricing-seed`, `contact-endpoint`, `refund-policy-page`): 29/29. Landing section viewed in the browser: renders, no horizontal overflow.

**Risks** — pre-existing: Privacy §7 hosting location (United States vs Delhi) and the landing FAQ's permission list are out of date; raised as a separate task, not changed here.
