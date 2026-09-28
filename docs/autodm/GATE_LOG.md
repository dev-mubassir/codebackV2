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

---

## Gate 6 — release

**Built**: `docs/autodm/RELEASE.md` — merge checklist, Northflank variables per stage (A dark → B owner → C approved), post-deploy smoke test proving sorting is unchanged (flag off, then flag on), rollback table (flag off + restart; redeploy the previous build if pods crash-loop; never drop the migration), the human Meta steps in order, and the App Review draft for `instagram_business_manage_comments` (usage description, ~3-minute screencast script with a poll-fallback variant, reviewer test instructions with placeholders), plus known risks.

**Existing files touched**: none in this gate.

**Final state**: 7 local commits on `feature/autodm` (gates 1, 2, 3, 4, 5 legal, 5 landing, 6), nothing pushed. Full suite at Gate 4: 927 tests — 915 passed, 12 skipped, 0 failed (baseline 794/12/0 + 121 new). Frontend lint 0 errors, build passes.

---

## Gate 7 — pre-merge fixes

**Built / changed** (Auto DM module): poller sweeps through the scheduler's locked `runIfDue` (once across pods); `afterAdminResubscribe` hook; OPENER_UNCONFIRMED (graph `isUnconfirmedSendError`, worker, tap/keyword binding); new `access.js` (`hasAutoDmAccess`, extended in Gate 8); run-log label "DM not confirmed". Tests: `tests/autodm-gate7.test.js` (9).

**Existing files touched**
| File | Change | Diff |
|---|---|---|
| `backend/src/routes/admin.js` | resubscribe route: one `autodm.afterAdminResubscribe(...)` call (+ comment) after the default subscribe succeeds | +2 / −0 |
| `frontend/src/app/privacy/page.js` | §7: hosted in India; Meta, Google (Gemini), Resend may process data outside India | +4 / −4 |
| `frontend/src/app/page.js` | FAQ "What permissions are required?" lists exactly the two scopes requested today | +1 / −1 |

**Branches**: landing commit removed from `feature/autodm` (rebase); `feature/autodm-landing` created from `feature/autodm` with the landing commit + a FAQ commit adding `instagram_business_manage_comments`.

**Tests**: full suite **81 files (80 passed, 1 skipped); 936 tests: 924 passed, 12 skipped, 0 failed** — previous run 915/12/0 + 9 new.

**Flagged (not changed)**: Privacy §6 doesn't name Resend or Cashfree; backup region unverified.

---

## Gate 8 — admin-controlled access

**Built**: `features/autodm/access.js` (one access rule + rollout mode read/write), `features/autodm/adminRoutes.js` (`/api/admin/autodm`: overview, mode, grants, revoke), migration `20261002090000_autodm_access` (CREATE TABLE + unique index + FK from the new table to users — checked by the same statement grep; applied to local dev and test DBs), frontend `/admin/autodm` page + `lib/autodmAdminApi.js`, `/autodm` redirect to the dashboard without access. Every entry point (status, API, connect scope, subscribe calls, intake, taps, worker, poller) now calls `hasAutoDmAccess`.

**Existing files touched (this gate)**
| File | Change | Diff |
|---|---|---|
| `backend/prisma/schema.prisma` | `AutoDmAccess` model + back-relation on User (no columns) | +17 / −0 |
| `backend/src/routes/admin.js` | one `router.use('/autodm', …adminRouter)` after the admin auth/CSRF chain (+ comment) | +3 / −0 |
| `backend/src/routes/auth.js` | existing touch-point line: `await autodm.connectScopeOptions(user)` | +1 / −1 |
| `frontend/src/app/admin/_components/AdminShell.js` | one nav item "Auto DM" → /admin/autodm | +1 / −0 |

**Tests**: new `tests/autodm-access.test.js` (12: modes OFF/BETA/EVERYONE × granted / env-listed / other for status, 404s and a byte-identical connect URL; kill switch over every mode; revoke → worker, intake, poller and taps inert, re-grant resumes; mode OFF stops everyone; admin endpoints unreachable for customers and anonymous users, step-up and EVERYONE confirm, grant/list/revoke audited, cross-origin refused) + 1 regression test (sorting identical in OFF, BETA-with-grant and EVERYONE). Own Auto DM tests updated for the new model (helper puts tenants in BETA; status test rewritten).
Full suite: **82 files (81 passed, 1 skipped); 948 tests: 936 passed, 12 skipped, 0 failed** — previous run 924 + 13 new − 1 (status tests consolidated). One existing test (billing doctor) first failed because `prisma generate` was blocked by the running local backend (stale client); fixed by regenerating, no code or test change.
Frontend: lint 0 errors; build passes (`/admin/autodm` prerenders).

**Risks**: mode changes reach other pods within ~10 s; the local `.env` still has `AUTODM_ENABLED=true` + the bootstrap email, but the mode defaults to OFF, so Auto DM stays hidden locally until an admin sets Beta.

---

## Gate 9A — AI sorting ignores Auto DM conversations

**Built** (`interaction.js`, same seam, same fail-safe): an inbound DM from a sender who has an Auto DM run on that account with activity (`updated_at`) in the last 24 hours — any status except the pre-send ones (QUEUED, SENDING, WAITING_QUOTA) — while the owner has access, is stored and shown as today but marked `aiStatus 'autodm'`: no classification, no auto-reply, no AI credits. The DM itself never extends the window. A socket event `autodm:conversation` tells the open inbox. Order of checks: kill switch (no query) → cached rollout mode (OFF = no per-message query) → existing tap / LINK handling → one indexed run lookup → the owner's access. Any error → false → normal sorting.

**Existing files touched**
| File | Change | Diff |
|---|---|---|
| `backend/src/routes/api.js` | conversation list: the latest inbound message's `aiStatus` is selected, and `autoDm: true` is returned when it is `'autodm'` | +2 / −1 |
| `frontend/src/app/inbox/page.js` | approved touch point: the row shows a small "Auto DM" badge instead of the category when `conv.autoDm`; listens to `autodm:conversation`; `analysis_completed` clears the flag | +12 / −2 |

**Tests**: new `tests/autodm-window.test.js` (8): a reply in the window is stored/shown but not sorted (no Gemini call, no credit, ledger and counters unchanged, no auto-reply, list shows `autoDm`); every post-send status opens the window, QUEUED/WAITING_QUOTA don't; attachments too; another account's run never opens this account's window; after 24 h the DM is sorted; someone who never commented is sorted identically to a tenant without Auto DM; kill switch off / mode OFF / no access / revoked → byte-identical sorting; a failing check → normal sorting. `tests/autodm-regression.test.js`: the Gate 4 test "a mid-flow commenter's ordinary question is still classified" encoded the old rule and was replaced (this branch's own test, rule changed by this gate) with "a commenter whose run went quiet 24+ hours ago is classified and auto-replied".

## Gate 9B — plan limits, usage, enforcement

**Built**
- `limits.js` — per-plan limits (seed in code: TRIAL 30/1,000; STARTER 100/10,000; PRO 500/100,000 shown "Unlimited*"; ENTERPRISE = Pro's until set; unknown = TRIAL's), admin edits in `autodm_plan_limits`, the enforcement switch (app_settings `autodm_enforcement`, OFF default), "No limits" exemptions.
- `quota.js` — period = the entitlement's `cycleStartedAt` (calendar month without an entitlement); atomic reserve before the opener (`UPDATE … used = used + 1 WHERE id = … AND used < limit RETURNING`, in one transaction with QUEUED → SENDING); release on a definite failure; WAITING_QUOTA hold (never dropped) + a locked sweep every 2 min (`runIfDue('autodm_quota')`) that expires holds at 7 days, releases them oldest-first when there is room (period reset, upgrade, higher limit, enforcement off), and pauses automations over the limit after a downgrade (`paused_limit`, newest N kept, nothing deleted); 80% / 100% notices once per period (email + banner).
- Worker: reserve before the opener; SENDING runs never reserve twice. Routes: 409 `AUTOMATION_LIMIT` on create / edit / activate past the limit; `GET /api/autodm/usage`. Admin: `PUT /enforcement`, `PUT /plan-limits/:planCode` (both step-up), `PUT /grants/:userId/limits`, grants take `noLimits`, overview adds enforcement, plan limits and per-user usage; all audited.
- Poller: one comments call per post however many automations share it; posts under 48 h read every 2 min, 2–7 days every 15 min, older every 60 min; "any post" reads the latest 3; state per post in `autodm_media_states` (shared by pods; a post's publish time fetched once); intake ignores automations saved after a polled comment.
- Migration `20261003090000_autodm_limits`: 4 CREATE TABLE, their indexes, FKs from them, and one CREATE INDEX on `autodm_runs` (status, user_id) — checked by the statement grep; applied to local dev and test DBs. The diff tool also proposed `ALTER TABLE "user_sessions" RENAME CONSTRAINT …` (pre-existing drift between the local DB and the schema) — left out.
- Frontend: usage meter + notices on the Auto DM page, run labels "Held" / "Sending", "Paused (plan limit)"; admin page: enforcement switch, plan-limits editor, "No limits" on grants, usage table; billing page row.

**Existing files touched**
| File | Change | Diff |
|---|---|---|
| `backend/prisma/schema.prisma` | 4 new models; back-relations on User, InstagramAccount and Plan (no columns); one index on AutoDmRun | +74 / −2 |
| `backend/src/lib/email/index.js` | one sender `sendAutoDmUsage` (deferrable tier) | +4 / −0 |
| `backend/src/lib/email/templates.js` | one template `autodmUsage` (80% / 100%) | +28 / −0 |
| `frontend/src/app/billing/page.js` | approved touch point: one `<AutoDmBillingRow />` (renders nothing without Auto DM access) + its import | +2 / −0 |

**Tests**: new `tests/autodm-quota.test.js` (20): 20 concurrent sends at limit−1 → exactly one sends; only the opener counts, a definite failure is released; an unconfirmed opener counts; held at the limit and released on a period roll (`rollCycle`); released on upgrade; NO_PLAN held then released; 7-day expiry; enforcement off releases holds; notices at 80% and 100% once, none while off; enforcement OFF counts but never blocks; "No limits" never blocked (even with no plan); automation limit on create / activate / edit; downgrade keeps the newest N; paused_limit takes no comments; poller one call per post, tiers, latest 3, publish time fetched once; tier table; usage isolation between tenants; customers can't reach the new admin endpoints; step-up + audit for enforcement and plan limits, grant with "No limits", toggle, revoke removes it; admin usage list.
Full suite: **84 files (83 passed, 1 skipped); 976 tests: 964 passed, 12 skipped, 0 failed** — previous run 936/12/0 + 28 new (9A: 8; 9B: 20; the replaced regression test is 1-for-1).
Frontend: lint 0 errors.

**Risks**: the local DB migration was applied while the owner's backend was running; `prisma generate` succeeded this time (no DLL lock). Usage emails use the shared deferrable email quota (Resend 100/day) — at scale these notices compete with trial emails.

---

## Gate 10 — landing highlight, pricing, Terms

**Branches**: `feature/autodm` was fast-forwarded to `feature/autodm-landing` (its two commits — the Gate 5 landing section and the FAQ scope commit — are now literally in `feature/autodm`), then Gate 9 was committed on top, then this gate reworks the section.

**Built**
- `frontend/src/app/components/landing/AutoDmShowcase.js` — the section (left: copy, 4 benefits, CTA; right: animated phone mock of the commenter's Instagram).
- `frontend/src/lib/autodmAvailability.js` — one shared request per page to `GET /api/public/autodm-availability`; the "Coming soon" badge is always in the layout and only changes visibility.
- `frontend/src/content/autodmPlans.js` — the ONE place the public pages read Auto DM numbers (pricing rows, Terms fair use); pinned to the backend seed by `tests/autodm-landing.test.js`.
- `backend/src/features/autodm/availability.js` — `{ available: AUTODM_ENABLED && mode === 'EVERYONE' }`, cached 60 s (server + `Cache-Control: public, max-age=60`), rate-limited, no user data; kill switch off = no DB query.

**Screens changed** (checked in the browser against the local dev server; widths by viewport emulation)
| Screen | Desktop (1280) | Tablet (768) / mobile (360) |
|---|---|---|
| Landing — Auto DM section, now directly after "How it works" (the AI sorting walkthrough) and before "Capabilities" | Two columns: eyebrow "Auto DM" + "Coming soon" badge, headline "Turn every comment into a DM.", subline, 4 benefits (comment → DM with link/image/text; only followers get the link; Hindi and Hinglish keywords; no AI credits), "Start free trial" CTA. Right: a 300×620 flat phone that loops the flow (~14 s): reel → `@you LINK` → `@yourbrand Sent you a DM!` → DM "Replied to your comment: LINK" with **Send me the link** → tap → "Follow to unlock" with **I've followed** → tap → image card + "Here's your free guide" with an **Open guide** link card. Flat #f7f9ff band with 1px Royal Blue-tint borders; no gradients, no emoji, no stats; handles are illustrative (@yourbrand, @you, @ria.creates, @karan.fit). | One column below 960px: the phone is centred under the text (measured: stacked, centred). No horizontal scroll at 360, 768 or 1280 (scrollWidth = viewport). Headline 2.5rem (≤960px) / 2.05rem (≤480px). |
| Landing — motion | Text column and phone use the page's own reveal-on-scroll (added to its observer's selector, same easing/timing). The loop plays only while the phone is ≥20% visible and the tab is visible: 0 DOM updates measured while scrolled away. CLS measured over a full loop: **0**. | Same. Reduced motion (forced by overriding `matchMedia`): static phone showing the whole conversation (all 9 steps visible, 0 updates). |
| Landing — pricing | Under the title: "Your free trial includes Auto DM: 30 automations · 1,000 Auto DMs". Starter: "Auto DM: 100 automations · 10,000 Auto DMs/month"; Pro: "Auto DM: Unlimited* automations · Unlimited* Auto DMs"; Enterprise: "Auto DM: custom limits" — each with a small "Coming soon" badge. One footnote under the cards: "*Fair use applies. See Terms §8." → `/terms#fair-use`. Nothing else about limits. | Cards stack as before; the rows wrap inside the card. |
| Landing — FAQ | "What permissions are required?" → "Siffty requests instagram_business_basic and instagram_business_manage_messages. Auto DM additionally requests instagram_business_manage_comments. We never ask for your Instagram password." | Same. |
| `/terms` | New §8 **Fair use** (Unlimited = no fixed monthly count for one business's normal use; fair use 100,000 Auto DMs per Siffty account per calendar month and 500 active automations; Meta's 750 private replies/hour/account on every plan; above fair use sends may be queued or slowed and we may contact you; spam/reselling/automated abuse → suspension). Old §8–14 → §9–15; table of contents and badges renumbered; last updated 28 Sep 2026. | Same legal card layout. |
| `/privacy` | §6 names exactly: Meta (Instagram), Google (Gemini), Resend (email), Cashfree Payments (payments), Northflank (hosting); "authorities where the law requires" kept as a sentence. Last updated 28 Sep 2026. | Same. |
| Gate 9 screens (for completeness) | Auto DM page: usage card above the list (Auto DMs x / y with bar and reset date, automations x / y, notices); `/admin/autodm`: Limits panel (enforcement select, plan-limits table + edit dialog), "No limits" checkbox and column, "Usage this period"; billing page: Auto DM panel after the usage strip; inbox rows: "Auto DM" badge. | Usage card stats stack below 600px; admin tables scroll inside their wrapper like the other admin tables. Not opened in a browser (needs a signed-in session on the tunnel frontend); covered by the build and the backend tests. |

**Existing files touched**
| File | Change | Diff |
|---|---|---|
| `backend/src/index.js` | one mount: `/api/public` → the Auto DM availability router (public, no user data) | +1 / −0 |
| `frontend/src/app/page.js` | imports; the page's reveal selector gains `.autodm-reveal`; old 3-step section removed, `<AutoDmShowcase />` after #how-it-works; pricing trial line, 3 card rows, 1 footnote; FAQ answer | +20 / −44 |
| `frontend/src/app/landing.css` | the `.autodm-*` block replaced (section, phone, motion, reduced motion, pricing rows, footnote) | +476 / −26 |
| `frontend/src/app/terms/page.js` | §8 Fair use (numbers from the constants file), renumbering, date | +61 / −22 |
| `frontend/src/app/privacy/page.js` | §6 processors, date | +16 / −5 |

**Tests**: new `tests/autodm-landing.test.js` (11): constants = backend seed; the exact row strings; section position (directly after #how-it-works, old section gone); each card's row, the trial line, exactly one footnote linking to `/terms#fair-use`, no limit numbers typed into the page; FAQ text; no gradient/emoji/invented numbers in the section, reduced-motion CSS present; Terms numbered 1–15 without gaps with §8 Fair use and its five points; Privacy §6 names exactly the five processors; availability: kill switch off → false with no rollout-mode read, public, cached 60 s, no cookie; true only for EVERYONE; flips by itself after the cache.
Frontend: lint 0 errors (24 warnings, all pre-existing); build passes.
Full suite: **85 files (84 passed, 1 skipped); 987 tests: 975 passed, 12 skipped, 0 failed** — previous run (Gate 9) 964/12/0 + 11 new.
