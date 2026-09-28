# Auto DM — decisions log

One line per judgment call, with the reason. Order of preference when unsure:
(1) leaves sorting untouched, (2) more secure, (3) simpler and faster.

## Owner decisions (Gate 0, final)
- D1 Branch `feature/autodm` from origin/master @051f9d7; local master untouched.
- D2 Handed-off messages get `aiStatus:'autodm'` in the same transaction that claims the run.
- D3 Disconnect: inert immediately; daily cleanup deletes disconnected accounts' Auto DM data within 24h.
- D4 Touch points limited to the approved list (see GATE_LOG.md per gate).
- D5 Backend in `backend/src/features/autodm/`.
- D6 Auto DM's outgoing messages are not written to `messages`; they show in the run log.
- D7 Advanced Access risk accepted; poll fallback behind `AUTODM_POLL_FALLBACK`.

## Gate 1
- Upstream of `feature/autodm` unset right after branching (git auto-tracked origin/master; a bare `git push` would have targeted master).
- Migration SQL produced with `prisma migrate diff` (schema before → after) instead of `migrate dev`: no shadow DB, no chance of a reset, and the output is exactly the additive diff.
- `prisma format` was NOT kept: it realigned whitespace in existing models. The schema diff is additions only (138 lines added, 0 removed).
- `prisma migrate deploy` on the local dev DB also applied 3 pre-existing pending migrations (20260928…, 20260929…, 20260930…) — local only, required by the current code anyway.
- Migration folder `20261001090000_autodm` sorts after the newest existing migration (20260930090000).
- Table names prefixed `autodm_` (no clash with any existing or orphaned table).
- `userId` is denormalised onto every Auto DM table: every query filters by owner directly, and user deletion cascades even without the account row.
- Arrays (keywords, media ids, public replies) are Postgres `text[]` — no JSON parsing, and Prisma validates types.
- Image ↔ automation link lives on the image (`automationId` unique, cascade): deleting an automation deletes its image, so the public URL 404s.
- Flags are read from `process.env` on every call (never cached), so a restart — or a test — flips them.
- The extra scope and the second subscribe call happen only when `AUTODM_ENABLED` is ALSO true: with the kill switch off the connect flow is byte-identical for everyone.
- `GET /api/autodm/status` requires a session (one PK lookup by requireAuth, no Auto DM query) and returns `{enabled, available}`; `available` = enabled AND allowlisted, and drives the sidebar item, so real users never see a page they cannot use before approval.
- Every other `/api/autodm` route answers 404 `AUTODM_DISABLED` when off or not allowlisted (404, not 403: the feature's existence is not advertised).
- `/api/autodm` mounted before `/api` with a trailing `notFoundHandler`, the same pattern as `/api/admin` and `/api/billing` (the blanket requireAuth on `/api` would otherwise shadow it).
- Rate limiter: the existing `createRateLimiter` keyed per user, 120 requests/minute on `/api/autodm`.

## Gate 2 (with the OpenReply addendum folded in — Gate 2 was not yet committed, so no separate 2b)
- OpenReply cloned read-only to /tmp/openreply (commit 5760181, MIT, both copyright lines verified in its LICENSE). Nothing installed or executed from it; ported pieces rewritten in our JS style; THIRD_PARTY_NOTICES.md added; header "Adapted from OpenReply (MIT)" on matcher.js, graph.js, worker.js, poller.js, intake.js and tests/autodm-matcher.test.js.
- Opener and follow prompt are a button template with ONE postback button (OpenReply). Quick replies are no longer sent; the seam still accepts an AUTODM: quick_reply payload (harmless, robust).
- Opener and follow-prompt text capped at 640 chars (Meta's button-template text limit) instead of the spec's 900 — the stricter limit wins.
- Postbacks today: processEntry's messaging loop has no postback branch (message / read / reaction only), so a postback is silently ignored; `messaging_postbacks` is not in subscribed_fields, so none arrive. The new `else if (autodm.isAutoDmPostback(event))` branch sits LAST in that chain: every other postback still matches nothing, byte-for-byte as before.
- `messaging_postbacks` could not be proven unnecessary (Meta's button-template doc lists it; OpenReply subscribes only comments+messages). It is added ONLY to the allowlisted second subscribe call; if Meta refuses that field set, the call is retried once with comments only.
- Follow check returns true/false/null and never throws. After a tap only `false` means not following; `null` fails OPEN (link sent) and `last_error = FAIL_OPEN` is recorded — no new column (a column add would be an ALTER TABLE, which the migration rule forbids even on our own table).
- Max 3 follow checks: the 3rd `false` sends the polite final message and stops (NOT_FOLLOWING).
- AUTODM_POLL_FALLBACK replaced by AUTODM_POLL_MODE = off|allowlist|all, default allowlist; unknown values = off; always off while AUTODM_ENABLED is off. `allowlist` uses the explicit email list (ignores AUTODM_SCOPE_ALL) so `all` stays a separate, deliberate switch.
- Poller (OpenReply's reconciler): every 2 min, 72h lookback, ≤30 new comments per automation per sweep, oldest first, 10 recent posts for "any post" automations, 15-minute account pause on 368 and other rate-limit codes. Siffty change: never looks before the automation's `updatedAt`, so creating/re-activating/editing an automation never DMs people who commented before it (OpenReply would reply to the last 72h).
- Poller dedupe = our unique commentId (one DB query per automation per sweep), no "already replied" Graph calls. Only top-level comments are polled (replies come by webhook).
- `poll_cursor_at` now records the last completed sweep per account (ops visibility); the lookback window replaced the cursor idea.
- Matcher = OpenReply pipeline (Arabic-script folding, Latin-only diacritic folding, O/0 fold for numeric keywords, strip punctuation/emoji) with two Siffty changes: combining marks count as part of a word (strict whole-word for Devanagari: "कीमत" does not match "कीमतें"), and emoji-only keywords match by containment (OpenReply drops them).
- Rate limiter: OpenReply's Redis limiter DROPS a DM after 3 requeues; ours already re-queues overflow without dropping, so ours is kept (DB count of openers sent in the last hour, cap 700 < Meta's 750, deferral does not consume an attempt). Not atomic across instances; the 50-reply headroom absorbs that.
- Exclude words veto under both trigger types (fewer DMs is the safe direction).
- Intake drops comments already 7+ days old (no run, so the commenter's one-per-automation slot is not burned); the worker marks EXPIRED if an opener is still unsent at 7 days.
- Webhook comments carry no timestamp: `entry.time` is used (seconds or ms, same rule as the DM path).
- Public reply is at-most-once: `public_reply_at` is stamped BEFORE posting, so a crash can never post twice; its failure never blocks the private reply.
- Private reply / DMs go to `/me/messages`, the same endpoint the existing, proven sendMessage uses (the token scopes it to the account).
- If Meta returns no `recipient_id`, the commenter id is stored as igsid (logged). If they differ, taps simply fall through to normal sorting — safe failure.
- A verified tap on a run that is busy or finished is still "ours" (message marked autodm, not classified) but changes nothing — a double tap never re-sends.
- A spoofed tap (another tenant's run id, wrong sender, malformed payload) is ONE indistinguishable query miss → false → normal sorting (no oracle).
- Main message with a link whose plain-text fallback would exceed Meta's 1000-byte text limit is sent as two messages (text, then link).
- The worker loop does not auto-start under NODE_ENV=test; tests call tick() (same idea as RUN_IN_PROCESS_SCHEDULER=false in the suite).
- Claim SQL compares with `NOW() AT TIME ZONE 'UTC'` because Prisma stores timestamp(3) in UTC; correct regardless of the DB session time zone.
- Backoff 15s·2^(n-1), 5 attempts; Meta rate limit → 15 min; dead token → account flagged via the existing lib/tokenHealth and the run fails at once.
- Cleanup runs every 6 hours (not daily) so "within 24 hours of disconnecting" always holds; it runs even with AUTODM_ENABLED off (retention is a privacy duty). It also deletes a previous owner's rows when the account moved to another workspace (the reconnect re-points the same account row).
- The public image route is not behind AUTODM_ENABLED: an image already in a delivered DM keeps resolving; no new DM can reference one while the feature is off.
- Images: magic bytes decide (client Content-Type ignored); ≤20 unattached uploads per user per 24h; `Cache-Control: public, max-age=3600` so a deleted automation's image stops being served from caches within the hour; CORP cross-origin (Meta and the app fetch it cross-origin).
- Sidebar/API availability = enabled AND allowlisted (not just enabled), so real users never meet a page they cannot use before approval.
- Account list and automation reads also check AutoDmAccountState.userId = caller (belt and braces for a moved account).
- Graph client uses the shared axios module object (not an instance) so the suite's Meta boundary stub reaches it.

## Gate 3
- Sidebar: `navItems.js` gets an `autodmEnabled` flag (like `billingEnabled`); AppShell reads it through `useAutoDmStatus`, which calls GET /api/autodm/status (never a NEXT_PUBLIC_ flag), caches 60s across page navigations, and treats any error as "hidden". The item shows only when enabled AND allowlisted.
- Nav label is a literal "Auto DM" in navItems.js (one line) rather than a new key in content/copy.js; all other Auto DM wording lives in `components/autodm/copy.js` so the feature stays in its own folders.
- Nav icon `send` (existing icon set) — every nav item has an icon; that is navigation, not decoration. No icons in the Auto DM empty states, no emoji anywhere, no sample/fake rows.
- Pages: `/autodm` (list), `/autodm/new?account=`, `/autodm/edit?id=`, `/autodm/runs?id=` — query strings rather than dynamic segments, each wrapped in Suspense (Next 16 requirement for useSearchParams in prerendered pages, same pattern as settings/inbox).
- `frontend/src/lib/autodmApi.js` imports the existing axios instance (`api.js` untouched), so session-expiry and maintenance handling apply.
- Effects never set state synchronously (React Compiler lint `set-state-in-effect`): fetches are started inside the effect and state is set in their callbacks, matching the existing pages; the rule was not disabled.
- Live updates: list and run log subscribe to `autodm:run_created` / `autodm:run_updated` via the existing `createSocket()` and refetch (debounced); counts never come from the event payload.
- Wizard validation mirrors the server (limits in one place per side); a field's error clears as soon as it is edited.
- DM preview renders only what the user typed (placeholders otherwise); the desktop note names their fallback keyword.
- Image preview: a fresh upload shows a local object URL; a saved image loads from the public image route.
- Visual check done on an ISOLATED local preview (backend :5050 with Auto DM on, frontend copy :3050 with its own .next) so the user's running :3000/:5000 dev servers were never touched; a throwaway local user was seeded and deleted afterwards (cascade verified: 0 rows left). "Specific posts" was not clicked in the preview, to avoid calling Meta with a fake token.

## Gate 4
- Tests drive REAL signed webhooks through the real route, durable inbox and in-memory queues; only the shared axios object (Meta HTTP) and the AI provider calls are stubbed. `tests/helpers/autodm.js` is a new helper; no existing test or helper was edited.
- The "byte-identical" connect test compares the authorize URL with a LITERAL reconstruction of the pre-Auto-DM format and the exact `subscribed_fields` string, so any drift fails loudly.
- The regression test compares a full outcome object (inbound status + category, conversation category/priority, outbound auto-reply, the exact send call, analysis count) between flag off and flag on with a live automation and a mid-flow run on the same account.
- Comment-only retry test accepts either the queue's own retry or the recovery sweep (both are production paths) and asserts exactly one processed delivery and one run.
- Kill-switch tests assert via spies that no Auto DM table query and no claim SQL run while AUTODM_ENABLED is off.

## Gate 5
- Privacy Policy: Auto DM added to §1 (what Siffty is, "commenter" defined), §3 (data processed: comment text, commenter username + Instagram-scoped ID, media ID, follow status at the check), §3 purpose ("only to deliver the automated reply") and the fact that comments are never sent to Gemini (Auto DM makes zero AI calls), §4 use, §6 sharing (Meta: comments), §8 retention (run logs 90 days; all Auto DM data within 24 hours of disconnecting, immediately on purge / Meta deletion / account deletion), §9 deletion list, never-sold callout. No sections added or renumbered in the privacy page (its numbered cross-references stay valid).
- Terms: new "5. Auto DM (comment replies)" section (customer owns content and links; Instagram Community Guidelines + Meta Platform Terms; no spam or misleading links; Siffty may pause automations). Later sections renumbered 6–14; anchor ids unchanged, and no page references Terms sections by number.
- Data deletion page: Auto DM automations, images and run logs in "what gets deleted", and the disconnect exception.
- Landing: one section ("SECTION 4 — AUTO DM", the numbering already skipped 4) and one FAQ entry; no pricing change, no "unlimited" claim. Both say "Auto DM is being rolled out gradually" — the page is public while the feature is allowlist-only, and the landing must not promise something a visitor cannot use yet.
- Legal and landing are committed separately, so the landing commit can be held back or reverted on its own if the merge happens before general availability.
- Two pre-existing inaccuracies found (NOT changed — outside this feature): Privacy §7 says hosting is in the United States (production is in Delhi since the cutover), and the landing FAQ "What permissions are required?" lists Facebook-login scopes the app never requests. Raised as a separate task.

## Gate 6
- RELEASE.md uses three stages: A = merged dark (`AUTODM_ENABLED=false`), B = owner-only (`true` + allowlist), C = after approval (`AUTODM_SCOPE_ALL=true`). Flags are `api` service-level variables (same place as RUN_IN_PROCESS_SCHEDULER), and every change needs an `api` restart (OPERATIONS.md).
- Flag verification uses `GET /api/autodm/status`, not `configCheck --expect`, because that CLI only accepts a fixed key list and extending it would touch an existing file.
- The App Review usage paragraph is adapted from OpenReply's META_APP_REVIEW.md (comments-permission paragraph only) and rewritten for Siffty's actual behaviour (private reply via the Private Replies API, optional public reply, owner's own media, poller fallback, retention).
- The screencast script includes the poll-fallback variant for recording before comment webhooks are delivered.
- Reviewer instructions use placeholders; no credentials are written to the repo.
- /tmp/openreply is left in place (outside the repo) for reference; it is not used by the build.

## Gate 7 (pre-merge fixes)
- Landing commit moved off `feature/autodm` with a non-interactive `git rebase --onto` (local, unpushed branch). A local tag `autodm-pre-gate7` keeps the old tip. The landing work now lives on `feature/autodm-landing`, rebuilt on top of `feature/autodm`.
- Poller lock: reuses the scheduler's own exported `runIfDue()` (jobs/scheduler.js) — same advisory-lock pool (no new DB connections), a due-check inside the lock (so a second pod that gets the lock right after the first finishes skips too), and a `job_runs` row `autodm_poll` every sweep (visible on Admin → Health, pruned after 30 days like `webhook_recovery`). No change to scheduler.js.
- Admin re-subscribe: one line in routes/admin.js after the default subscribe succeeds, calling `autodm.afterAdminResubscribe()`, which does the extended call only for an account whose Auto DM state says comments granted (same owner) AND whose owner has Auto DM access; never throws; no-op otherwise, so the admin action is byte-identical for everyone else.
- OPENER_UNCONFIRMED = no HTTP response AND a code meaning the request may have reached Meta (ECONNABORTED/axios timeout, ETIMEDOUT, ECONNRESET, EPIPE, socket hang up). A connection that never happened (ENOTFOUND, ECONNREFUSED) keeps the normal retry — nothing was sent. A Meta error WITH a response keeps the existing backoff.
- An unconfirmed run stores the comment's `from.id` as a provisional igsid (LINK replies match it). A GET tap carrying the unguessable run id — seen only by the opener's recipient — binds the tapper as the igsid and moves the run to OPENER_SENT; FOLLOWED taps and other run ids never bind.
- Unconfirmed openers count toward the hourly private-reply cap (they probably went out).
- Privacy §7 now says: hosted in India; Meta, Google (Gemini) and Resend may process data outside India. Flagged, NOT changed: §6 "Sharing" still does not list Resend (email) or Cashfree (payments) as processors; whether Northflank backups sit in the same India region is not verified from the repo.
- Landing FAQ "What permissions are required?" now lists exactly instagram_business_basic and instagram_business_manage_messages (on `feature/autodm`); `feature/autodm-landing` adds instagram_business_manage_comments.

## Gate 8 (admin-controlled access)
- `hasAutoDmAccess(user)` in `features/autodm/access.js` is the ONE rule: AUTODM_ENABLED AND (EVERYONE OR (BETA AND (grant row OR env list))). Used by the status route, the API gate, connect scope, both subscribe calls, intake, taps (seam + postbacks), worker and poller.
- Rollout mode = the app_settings row `autodm_rollout_mode` (OFF default). NOT registered in lib/settings.js DEFINITIONS: the generic settings editor renders only booleans/numbers and would mis-render an enum; the Auto DM module owns the value. Cached 10 s per pod (setRolloutMode updates the local cache at once); grants are read uncached, so a revoke is immediate.
- `autodm_access` (userId unique, cascade on user delete). `granted_by_admin_id` is plain text, no FK: removing an admin must not remove their grants, and the admin audit log keeps the history. No FK = no change to the AdminUser model.
- `AUTODM_SCOPE_ALL` is no longer read; EVERYONE replaces it. `AUTODM_SCOPE_ALLOWLIST` stays as the BETA bootstrap only (ignored in OFF).
- Poll mode `allowlist` now means "named beta users" (grant or env list); `all` = every owner with access.
- auth.js: the existing touch point line now reads `await autodm.connectScopeOptions(user)` (same function; async because access needs the grant table, and it takes the user object because grants are keyed by user id). No new touch point.
- Status without access returns exactly `{enabled:false}`; with access `{enabled:true, available:true}`. The `/autodm` pages redirect to /dashboard without access and show only a skeleton meanwhile (the old "not available yet" text was removed so the feature stays invisible).
- Revoke/mode OFF in the worker: the run is deferred 5 minutes (attempt not counted, status unchanged, nothing sent, nothing deleted), so a re-grant resumes it within ~5 minutes. The 7-day private-reply window still applies.
- Seam: the access check runs only for candidate messages (an AUTODM payload or a short text), so ordinary DMs pay no extra query; the check happens before any run lookup. Kill switch off: still no Auto DM query at all.
- Admin API mounted with one line in routes/admin.js after requireAdmin + adminOriginGuard + trackAdminActivity (existing admin session, role and CSRF). Mode changes need step-up (they affect every user); EVERYONE additionally needs `confirm: 'EVERYONE'` (the UI shows a confirm dialog first). Grants need a note (it is the audit reason), revokes a reason — the existing admin "every change has a reason" pattern. Audit actions: AUTODM_ROLLOUT_MODE, AUTODM_ACCESS_GRANT, AUTODM_ACCESS_REVOKE.
- Admin page is its own route + one nav item in AdminShell; labels are literals in the page (content/copy.js untouched).
- `prisma generate` could not replace the query-engine DLL while the owner's local backend held it (EPERM), which left the generated client's schema copy stale and made the existing billing-doctor test report "client STALE" (1 failure). Fixed without touching code or tests: the in-use DLL was renamed aside (`query_engine-windows.dll.node.inuse-old`, same version) and the client regenerated. The leftover file can be deleted after the local backend restarts.
- Visual check of /admin/autodm was not possible locally: the :3000 frontend talks to the tunnel domain, so an admin session from localhost doesn't stick. Covered by 12 backend tests + a passing build.

## Gate 9A (AI skip window)
- "Activity" = the run's `updated_at`. Every real step (opener, tap, follow prompt, link, failure, expiry) writes the run, so it moves; the DM from the person does not touch the run, so it never extends the window. A claim/lease also bumps it — that is a send in progress, i.e. activity.
- "Any status except QUEUED" also excludes SENDING and WAITING_QUOTA (9B): nothing has been DMed yet (and they have no recipient id, so they could not match anyway).
- Mode OFF is checked first from the 10 s cache, so with the mode OFF the messaging path makes no per-message Auto DM query (the kill switch still makes none at all). Otherwise ONE indexed query (instagram_account_id, igsid) per DM; the access check runs only when a run is found (candidates keep their Gate 8 order: access first).
- Inbox label: the conversation row shows "Auto DM" instead of the category when its latest inbound message is `'autodm'`. The data comes from the existing list query (one more selected field on the message it already loads, `autoDm` boolean on the row). Folder filters still use the category. Live: `autodm:conversation` sets it; `analysis_completed` clears it. The detail drawer is unchanged (kept the diff minimal).

## Gate 9B (plan limits)
- Plans mapped by code: Free trial = TRIAL, Starter = STARTER, Pro = PRO, Enterprise/custom = ENTERPRISE. The catalogue has exactly these four (checked on the local DB). ENTERPRISE has no seed row; until an admin sets it, it uses Pro's limits (not zero — never block the biggest customer by accident; not unlimited). Flag: set Enterprise limits per customer on /admin/autodm.
- Seed in code, not in the migration: Auto DM migrations only CREATE (the Gate rules forbid anything else), and the plan ids are random UUIDs per database. A row is written only when the admin edits a plan. Read failures fall back to the defaults, never to unlimited.
- Rollover: the existing credit ledger (`credit_ledger`, `CreditPool` enum) can't be reused without altering an existing enum/table (a hard stop), so usage is its own table. Its period follows the same clock as the plan's credits — the entitlement cycle restamped by grantPlan() and rollCycle() — so a new period starts when credits roll. Unused Auto DMs do NOT carry over: it is an allowance, like the classification count, not purchased credits. FLAG: if you want carry-over like reply credits, that is a product decision (and a bank cap).
- "No active plan" = effective status not TRIALING/ACTIVE. GRACE counts as no plan, matching auto-replies (Auto DM acts in the customer's name); nothing is dropped — runs wait until renewal or expire at 7 days.
- A run is counted at reservation; SENDING marks the reservation (status column is a string, no migration). Definite failure → release (SENDING → QUEUED, used − 1). Unconfirmed → kept. Expired while SENDING → released. Release after a crash uses the current period (floor 0) — a rare cross-boundary case is off by one at most.
- Held runs are NOT claimable (pending_action NULL), so thousands of held runs never starve other users' queue. The sweep releases at most 500 per user per 2-minute sweep, oldest comment first, and only as many as the allowance has room for.
- Notices only while enforcement is ON and the user is not exempt (emails that say "you hit your limit" while nothing is blocked would be false). Once per period per level, claimed with `UPDATE … WHERE warned_x IS NULL`. The email is deferrable in the shared quota.
- Downgrade pausing uses a new automation status `paused_limit` (no migration): intake, poller and the worker only use `active`, so paused ones take no comments. The toggle shows "Paused (plan limit)"; turning one back on is checked against the limit. Not auto-resumed on upgrade (the user chooses which ones).
- "No limits" is a separate table (`autodm_exemptions`) rather than a column on `autodm_access` (adding a column would be an ALTER). The admin sets it on the grant form or per grant; revoking a grant also removes it. It applies in every rollout mode.
- Automation limit counts active automations across all of the user's accounts (limits are per Siffty account, like the Terms fair-use wording).
- Poller: tiers by the post's publish time (from `/me/media` for recent posts, else one `GET /{media-id}?fields=timestamp` per post, ever); unknown = treated as new (2 min). Poll state lives in `autodm_media_states` so every pod shares it; the advisory lock and the 15-minute rate-limit pause are unchanged. The old per-automation "since" filter moved into intake (poll source ignores automations saved after the comment), and the poller pre-filters by the account's oldest automation so the 30-per-post cap is not wasted.

## Gate 10 (landing, pricing, Terms)
- "The AI sorting section" = `#how-it-works` ("Three steps from chaotic DMs to closed business" — connect, AI organizes, act). The Auto DM section now sits directly after it, before the Capabilities deck: the first product section after the hero and the only two-column, full-bleed tinted band, so it is the most prominent thing after the hero.
- Branch: fast-forward (not cherry-pick) so the landing commits are literally in `feature/autodm` and `feature/autodm-landing` can be deleted with a plain `git branch -d` (no force).
- Pricing is NOT data-driven on the landing page (hand-written JSX pinned to the seed by `landing-pricing-seed.test.js`, for payment-gateway compliance), so the Auto DM numbers live in one shared constants file, `frontend/src/content/autodmPlans.js`, read by the pricing rows and the Terms. The backend cannot import a frontend file in production (separate images), so the backend keeps `DEFAULT_LIMITS` and `tests/autodm-landing.test.js` fails if the two differ. The signed-in pages (meter, billing row) read the live limits from the API.
- The landing has no Trial card, so the trial row is one line under the pricing title. Enterprise gets "Auto DM: custom limits" (it is admin-set), matching its other "Custom …" rows.
- One footnote only, directly under the cards (before the add-ons box). The asterisk on the meter/billing row links to the same Terms anchor.
- Availability endpoint: `/api/public/autodm-availability` mounted in `src/index.js` (one line, before `/api`). The frontend makes one request per page load (shared promise); unknown or error = not available, so the badge stays. The badge is always rendered and only toggles `visibility`, so its appearing or disappearing never moves anything.
- Motion: CSS transitions on opacity/transform with the page's `cubic-bezier(0.16, 1, 0.3, 1)` and 0.6 s (the page's reveal values), one CSS keyframe for the tap ripple, no library. The reveal of the two columns reuses the page's own IntersectionObserver by adding `.autodm-reveal` to its selector. The chat "scroll" is a transform set directly on the DOM node (not state), and every mock element is always laid out, so layout-shift entries stay at 0 (measured). Reduced-motion and tab-visibility come from `useSyncExternalStore` (no setState in effects — the React Compiler lint rule).
- Playback is tied to the PHONE being ≥20% visible, not the section: on a phone-sized screen the stacked section is taller than the viewport and a section threshold was never reached in a short window.
- Brand: flat surfaces and 1px borders in the section and phone; the CTA reuses the landing's existing primary button (its existing shadow is the landing's own component, not new styling). No gradients in the new block (the test checks), no emoji, no stats or testimonials.
- Terms: the Fair use section is §8, right after "Plans, credits and payments"; later sections renumbered 9–15 (the only in-page cross-reference, "section 5", is unaffected). Its numbers come from the constants file (Pro's real limits and Meta's 750/hour).
- Privacy §6: the five processors named, nothing invented; "Hosting and infrastructure providers" became "Northflank (hosting)"; authorities kept as a sentence (not a processor). §7 unchanged.
