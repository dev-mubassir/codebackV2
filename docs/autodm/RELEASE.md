# Auto DM — release

Branch `feature/autodm` (local, never pushed), based on origin/master @051f9d7.
Everything ships **dark**: with `AUTODM_ENABLED` unset or `false`, OR with the
admin rollout mode at its default `OFF`, production behaves exactly as today
(proved by `tests/autodm-regression.test.js` in every mode and the
byte-identical connect tests).

**The rollout is done from the admin page `/admin/autodm`, not from env.**
`AUTODM_ENABLED` is only the server kill switch over everything. **Limit
enforcement stays OFF until billing is re-enabled** (after Meta approval):
with it off, Auto DM usage is counted and shown but nothing is ever blocked.

| Commit | What |
|---|---|
| `autodm: gate 1` | 4 new tables (additive migration), config flags, status route |
| `autodm: gate 2` | intake, matcher, queue worker, taps, poller, API (OpenReply parts, MIT) |
| `autodm: gate 3` | sidebar item, list, wizard, run log |
| `autodm: gate 4` | tests, manual test script |
| `autodm: gate 5` | Privacy, Terms, data deletion |
| `autodm: gate 6` | this document (first version) |
| `autodm: gate 7` | poller runs once across pods, admin re-subscribe keeps `comments`, unconfirmed openers never retried, Privacy §7 (India), FAQ scopes |
| `autodm: gate 8` | admin-controlled access: rollout mode, `autodm_access` table (additive migration), `/admin/autodm` |
| `autodm: gate 5 — landing …` + `landing FAQ …` | the landing commits, brought back from `feature/autodm-landing` (fast-forward; that branch is deleted) |
| `autodm: gate 9` | AI sorting skips Auto DM conversations (24 h); plan limits, usage, WAITING_QUOTA, enforcement switch, "No limits", usage meter + billing row, per-post poller (additive migration) |
| `autodm: gate 10` | landing Auto DM section (after "How it works"), `GET /api/public/autodm-availability` + "Coming soon" badges, pricing rows + one fair-use footnote, Terms §8 Fair use, Privacy §6 processors, FAQ |
| `autodm: gate 11` | this document (release prep) |

The landing section is now part of `feature/autodm` and ships with the merge. It is safe to ship before approval: the section and the pricing rows carry a **"Coming soon"** badge until the admin sets the rollout mode to **EVERYONE**, and the badge disappears by itself within about two minutes of that (no redeploy).

---

## 1. Merge checklist

1. [ ] Push `feature/autodm` and open a PR into `master` yourself (`git push -u origin feature/autodm`). Nothing was pushed by the build loop.
2. [ ] CI green: backend suite (see GATE_LOG for the latest counts: 0 failed, 12 skipped) and the frontend build.
3. [ ] Read the three migrations once — only `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, and foreign keys from new tables:
   - `backend/prisma/migrations/20261001090000_autodm/migration.sql` (four `autodm_*` tables)
   - `backend/prisma/migrations/20261002090000_autodm_access/migration.sql` (`autodm_access`)
   - `backend/prisma/migrations/20261003090000_autodm_limits/migration.sql` (`autodm_plan_limits`, `autodm_usage`, `autodm_exemptions`, `autodm_media_states`, one index on `autodm_runs`)
   No existing table is altered and no row is written. The rollout mode and the enforcement switch are rows in the existing `app_settings` table (keys `autodm_rollout_mode`, `autodm_enforcement`), created when an admin first sets them; plan limits use the defaults in code until an admin edits a plan. The `release` workflow runs the migrations through the `migrate` job before `api`/`web` are built.
4. [ ] **Before merging**, set `AUTODM_ENABLED=false` on the `api` service (section 2). Unset already means off; the explicit value makes the state visible.
5. [ ] Legal pages (Privacy, Terms incl. §8 Fair use, data deletion) must be live **before** you submit App Review — they ship with this merge.
6. [ ] `THIRD_PARTY_NOTICES.md` is in the repo root (OpenReply MIT notice).
7. [ ] Landing: after the deploy, the Auto DM section (right after "How it works") and the pricing rows show **Coming soon**. That is expected until the mode is EVERYONE.
8. [ ] Still open (flagged, not changed): whether Northflank backups sit in the India region is not verified (Privacy §7 says the service and database are hosted in India).
9. [ ] Merge. The `release` workflow builds, runs `migrate`, then deploys `api` and `web` (rolling).

## 2. Controls

### Server (Northflank project `siffty`, service `api`, service-level variables)

| Variable | Meaning | Value |
|---|---|---|
| `AUTODM_ENABLED` | kill switch over everything | `false` at merge; `true` when you start testing (Stage B) and after |
| `AUTODM_POLL_MODE` | comment poller: `off` \| `allowlist` (named beta users) \| `all` (everyone with access) | unset (= `allowlist`); `all` or `off` after approval |
| `AUTODM_SCOPE_ALLOWLIST` | optional bootstrap: these emails count as beta users while the mode is BETA | usually unset — use admin grants instead |

`AUTODM_SCOPE_ALL` is no longer read (the EVERYONE mode replaces it). After any variable change: **restart `api`** (a variable change does not reach running pods). `BACKEND_URL` must stay `https://api.siffty.com` (image URLs Meta fetches).

### Admin page `/admin/autodm` (no restart needed)

- **Rollout mode** — `OFF` (default: nobody) → `BETA` (granted users + the env bootstrap list) → `EVERYONE`. Every change asks for a reason and your password again (step-up); `EVERYONE` also asks for an explicit confirmation. Other pods pick a mode change up within ~10 seconds.
- **Beta access** — grant by email (the user must already have a Siffty account; a note is required), revoke per user. A revoke takes effect immediately: that user's automations, pending runs, comment intake, taps and polling stop; nothing is deleted; re-granting resumes them.
- Per-user counts: automations, DMs sent, failures. Every change is written to the admin audit log.
- **Limits** — the enforcement switch (**keep OFF until billing is re-enabled**; step-up), per-plan limits (automations and Auto DMs per billing period; "shown as Unlimited*"; step-up), and "No limits" per grant for testers and the **Meta reviewer** (never blocked, in any mode). "Usage this period" lists the top users. Launch defaults: Trial 30 / 1,000, Starter 100 / 10,000, Pro 500 / 100,000 shown as Unlimited*; Enterprise uses Pro's until you set it.
- With enforcement ON: out of allowance (or no active trial/plan) → new comments are **held**, never dropped, and go out when the period resets, the user upgrades or you raise the limit (within 7 days of the comment); 80% / 100% notices by email and on the Auto DM page; automations beyond the plan are paused (newest kept) and cannot be activated.

`hasAutoDmAccess(user) = AUTODM_ENABLED AND (EVERYONE OR (BETA AND (grant OR env list)))` — one function (backend `features/autodm/access.js`) decides the status route and sidebar, the API (404 without access), the Instagram connect scope, both subscribe calls, intake, taps, worker and poller. Without access the feature is invisible: `GET /api/autodm/status` → `{"enabled":false}`, the `/autodm` pages redirect to the dashboard, and the connect URL / subscribe call are byte-identical to today.

## 3. Post-deploy smoke test (Stage A) — sorting is unchanged

Right after the merge deploys (`AUTODM_ENABLED=false`, mode OFF):

1. `https://api.siffty.com/health` → ok. Within about an hour, Admin → Health lists `autodm_cleanup` with a successful run.
2. `api` logs: no `[autodm]` error lines.
3. Row counts only: `autodm_runs`, `autodm_automations`, `autodm_account_states`, `autodm_images`, `autodm_access`, `autodm_plan_limits`, `autodm_usage`, `autodm_exemptions`, `autodm_media_states` exist and hold 0 rows.
4. **Sorting:** from a test Instagram account, DM a connected business account `Hi, what's the price for one reel edit?` → it appears live in the inbox, gets a category (`aiStatus` `completed`, never `autodm`), and auto-reply follows that tenant's reply mode. Admin → Health: webhook backlog 0.
5. **Connect flow:** as a normal user start "Connect Instagram" and read the redirect URL (don't finish): `scope=instagram_business_basic,instagram_business_manage_messages` — nothing else.
6. As a normal user: no **Auto DM** in the sidebar; `GET /api/autodm/status` → `{"enabled":false}`; `/autodm` redirects to the dashboard.
7. Admin → **Auto DM**: server switch shows *Off*, mode *Off*, no grants, enforcement *Off*, plan limits all *Default*.
8. `https://api.siffty.com/api/public/autodm-availability` → `{"available":false}`; the landing section and pricing rows show **Coming soon**.

**Stage B** (you test): set `AUTODM_ENABLED=true`, restart `api` → still nobody has access (mode OFF) → **repeat step 4**. Then on `/admin/autodm`: mode → **Beta**, grant **your own email** → repeat step 4 once more (sorting identical with access on) → run `docs/autodm/MANUAL_TEST.md` against production with your tester accounts.

## 4. Rollback

| Symptom | Action |
|---|---|
| One user's automations misbehave | `/admin/autodm` → **Revoke** that user. Immediate; nothing deleted. |
| Auto DM misbehaves for everyone | `/admin/autodm` → mode **Off** (takes effect within ~10 s on every pod, no restart). |
| Limits hold or block people wrongly | `/admin/autodm` → enforcement **Off**. Held Auto DMs go out within ~2 minutes; usage is still counted. |
| Anything worse, or the admin page is unreachable | Set `AUTODM_ENABLED=false` on `api` → **restart `api`**. Inert everywhere: comment webhooks ignored, the DM seam returns false before any DB query, the loop idles, the API answers 404, the sidebar item disappears. |
| `api` pods crash-loop or fail to boot after the merge | Northflank → `api` → Deployments → **redeploy the previous build** (re-enable CD later: see `OPERATIONS.md`). Same for `web` if needed. |
| Need the code out of `master` | Revert the merge commit through a PR. |
| Database | **Do not** drop or roll back the migrations. The nine tables are additive and old code never reads them. |
| Meta side | Nothing required. Without access, comment/postback webhooks are stored, acknowledged and ignored. |

## 5. Human Meta steps, in order

1. Merge + deploy with `AUTODM_ENABLED=false` (Stage A), so the updated Privacy Policy, Terms and data deletion page are live.
2. App Dashboard → use case **Instagram API with Instagram Login** → Permissions → add `instagram_business_manage_comments` (Standard Access).
3. App Dashboard → Webhooks → Instagram → subscribe the app-level fields **`comments`** and **`messaging_postbacks`** (keep the existing ones).
4. App roles → Instagram testers: add your business account and 2–3 test accounts; accept each invite in the Instagram app.
5. Stage B: `AUTODM_ENABLED=true` → restart `api` → `/admin/autodm`: mode **Beta**, grant yourself.
6. In Siffty (prod), reconnect your business account; approve comment access. The Auto DM page must show the builder, not "Reconnect".
7. Run `MANUAL_TEST.md` on production. If comment webhooks do not arrive (Standard Access), the poller still delivers within ~2 minutes — note which path worked.
8. Business verification in Meta Business Manager, if not already done (usually required for Advanced Access).
9. Reviewer test account: a Siffty user (verified email) connected to a tester Instagram account → grant it on `/admin/autodm` **with "No limits"** (it must never be blocked).
10. Record the screencast (section 6) and submit App Review for **Advanced Access** to `instagram_business_manage_comments`.
11. After approval: `/admin/autodm` → mode **Everyone** (confirm). The landing and pricing **Coming soon** badges disappear within about two minutes. Optionally `AUTODM_POLL_MODE=all` or `off` (restart).
12. Only when billing is re-enabled (`BILLING_ENABLED=true`): `/admin/autodm` → enforcement **On**. Check "Usage this period" first — anyone already over their plan's allowance is held from then on.

### Rollout order (summary)

| Stage | `AUTODM_ENABLED` | Mode | Enforcement | Who has Auto DM |
|---|---|---|---|---|
| A — merged, dark | `false` | Off | Off | nobody (landing says Coming soon) |
| B — owner testing | `true` | Beta | Off | you (grant) |
| Review | `true` | Beta | Off | you + the reviewer (grant + No limits) |
| C — approved | `true` | Everyone | Off | everyone; badges gone |
| D — billing on | `true` | Everyone | **On** | everyone, within plan limits (reviewer/testers exempt) |

## 6. App Review draft — `instagram_business_manage_comments`

### Usage description (paste into the request)

> **How Siffty uses `instagram_business_manage_comments`.** Siffty is an inbox assistant for Instagram professional accounts. Its Auto DM feature lets the account owner set up a rule on their own posts or reels: when someone comments a keyword the owner chose (or any comment), Siffty receives the comment through the `comments` webhook and sends that commenter one private reply using the Instagram Private Replies API, with content the owner wrote — typically the link the commenter asked for. If the owner enables it, Siffty also posts one public reply under the comment. Siffty only acts on comments on the connected account's own media, sends at most one private reply per comment and one per person per automation, never replies to the account's own comments, and stays under Meta's limit of 750 private replies per hour per account. As a fallback for comments whose webhook did not arrive, Siffty reads recent comments on the posts the owner selected (`GET /{media-id}/comments`, the owner's own media only, last 72 hours). Comment data is used only to deliver the owner's reply, is never sent to any AI service, is never sold, and run logs are deleted after 90 days; all of it is deleted within 24 hours of disconnecting the account.
>
> *(Adapted from OpenReply's `META_APP_REVIEW.md`, MIT.)*

Related permissions already approved and unchanged: `instagram_business_basic` (identify the connected account, list its posts for the post picker) and `instagram_business_manage_messages` (the follow-up message with the link after the commenter taps the button or replies with the keyword; the follow check through the User Profile API).

### Screencast script (about 3 minutes, one take, narrated, production app)

Before recording: `/admin/autodm` mode **Beta**, the reviewer test account granted.

1. **Log in** to `https://app.siffty.com` with the reviewer test account. *"This is Siffty, an inbox assistant for Instagram professional accounts."*
2. **Connect Instagram**: open the Auto DM page → **Reconnect Instagram**. Show the Instagram consent screen and point at the comment permission being granted. Return to Siffty; the Auto DM builder now appears.
3. **Create an automation**: Create automation → name "Free guide" → *Specific posts* → pick a recent post → trigger *Keywords*: `guide` → message: keep the opener, main text "Here is your guide", link `https://example.com/guide`, button "Open guide" → Options: leave the follow gate off, turn on one public reply "Sent you a DM!" → **Save & activate**. Show it in the list, Active.
4. **Comment on a second phone** (a tester account): comment `guide please` on that post.
5. **Show the result on the second phone**: the public reply "Sent you a DM!" under the comment, and the private reply in DM requests with the **Send me the link** button. Tap it; the link message with **Open guide** arrives. Tap it to show it opens.
6. **Back in Siffty**: open the automation's **Run log** — the row shows the commenter, the comment, status *Delivered*, and what was sent.
7. *(Optional)* **Desktop fallback**: on instagram.com, a second tester comments `guide`, then replies `LINK` in the DM; the link arrives.
8. **Poll-fallback option** — if comment webhooks are not being delivered to the app yet (Standard Access): keep `AUTODM_POLL_MODE` at its default (`allowlist`) with the reviewer account granted. In steps 4–5, say *"Siffty picks the comment up within about two minutes"* and wait on the Run log until the row appears (marked "found by polling"); the rest is identical.
9. **Close**: show that the automation can be paused (toggle) or deleted, and that disconnecting Instagram stops Auto DM.

### Reviewer test instructions (paste into "Notes for reviewer"; fill the placeholders)

> 1. Go to `https://app.siffty.com/login` and log in with **[REVIEWER_EMAIL]** / **[REVIEWER_PASSWORD]** (a test Siffty account created for review).
> 2. The Instagram test account **[@TEST_BUSINESS]** is already connected. In the left menu open **Auto DM**. (If it says "Reconnect Instagram", click it and log in to Instagram as **[@TEST_BUSINESS]** / **[TEST_BUSINESS_PASSWORD]**, approving all permissions.)
> 3. Click **Create automation**, choose **Specific posts** and select the post captioned **"[POST_CAPTION]"**, set the keyword `guide`, keep the default messages, add the link `https://example.com`, and click **Save & activate**.
> 4. Log in to Instagram as the commenter test account **[@TEST_FAN]** / **[TEST_FAN_PASSWORD]** (a tester on our app) and comment `guide` on that post.
> 5. Within a few seconds (at most ~2 minutes) **[@TEST_FAN]** receives a DM with a **Send me the link** button. Tap it to receive the link. On a computer, reply `LINK` instead.
> 6. In Siffty, open **Run log** for the automation to see the delivered reply.
>
> Siffty only replies to comments on the connected account's own posts, sends one private reply per comment, and never sends anything the account owner did not configure. Privacy policy: `https://app.siffty.com/privacy` (see "Auto DM").

Never put real passwords in this document or in git; enter them only in Meta's review form.

## 7. Known risks

- **Pre-approval delivery.** Comment webhooks need a Live app and, for non-tester accounts, Advanced Access. Before approval, only tester accounts work; the poller is the fallback.
- **Postbacks.** Whether `messaging_postbacks` must be subscribed per account could not be proven from the docs. It is added only to the second (Auto DM) subscribe call, with a retry without it. If button taps never arrive, the reply keyword (`LINK`) still works.
- **Unconfirmed openers.** If the opener send times out, the run is `OPENER_UNCONFIRMED` and is never retried (one private reply per comment). If Meta never actually delivered it, that commenter gets nothing for this comment; the run log says so.
- **Mode propagation.** A rollout-mode change reaches other pods within ~10 s (cached); grants and revokes are immediate.
- **Desktop rendering.** Button templates may not render on Instagram desktop; the opener text names the reply keyword.
- **Enterprise limits.** No seed: an Enterprise customer uses Pro's limits until you set theirs on `/admin/autodm`.
- **No carry-over.** Unused Auto DMs do not roll over (an allowance, like the classification count). Reply credits still roll over as before.
- **Usage emails** share the deferrable email quota (Resend 100/day) with trial notices.
- **Fair-use numbers** on the landing page and Terms come from `frontend/src/content/autodmPlans.js`; `tests/autodm-landing.test.js` fails if they drift from the backend defaults. If you raise Pro's limits on the admin page, update that file too (and the Terms if the fair-use numbers change).
