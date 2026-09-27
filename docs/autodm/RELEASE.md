# Auto DM — release

Branch `feature/autodm` (local, never pushed), based on origin/master @051f9d7.
Everything ships **dark**: with `AUTODM_ENABLED` unset or `false`, production
behaves exactly as today (proved by `tests/autodm-regression.test.js` and the
byte-identical connect tests).

| Commit | What |
|---|---|
| `autodm: gate 1` | 4 new tables (additive migration), config flags, status route |
| `autodm: gate 2` | intake, matcher, queue worker, taps, poller, API (OpenReply parts, MIT) |
| `autodm: gate 3` | sidebar item, list, wizard, run log |
| `autodm: gate 4` | 121 tests, manual test script |
| `autodm: gate 5` (legal) | Privacy, Terms, data deletion |
| `autodm: gate 5` (landing) | landing section + FAQ — separate so it can be held back |
| `autodm: gate 6` | this document |

---

## 1. Merge checklist

1. [ ] Push `feature/autodm` and open a PR into `master` yourself (`git push -u origin feature/autodm`). Nothing was pushed by the build loop.
2. [ ] CI green: backend suite (baseline 794 passed + 121 Auto DM, 12 skipped, 0 failed) and the frontend build.
3. [ ] Read the migration once: `backend/prisma/migrations/20261001090000_autodm/migration.sql` — only `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, and foreign keys on the four new `autodm_*` tables. No existing table is altered. The `release` workflow runs it through the `migrate` job before `api`/`web` are built.
4. [ ] **Before merging**, set `AUTODM_ENABLED=false` on the `api` service (section 2). Unset already means off; the explicit value makes the state visible.
5. [ ] Decide on the landing commit (`autodm: gate 5 — landing …`). It says "rolling out gradually", but if you'd rather not mention Auto DM publicly before approval, revert that one commit in the PR.
6. [ ] Legal pages (Privacy, Terms, data deletion) must be live **before** you submit App Review — they ship with this merge.
7. [ ] `THIRD_PARTY_NOTICES.md` is in the repo root (OpenReply MIT notice).
8. [ ] Known pre-existing issues, not part of this change: Privacy §7 still says hosting is in the United States (production is in Delhi), and the landing FAQ's permission list is out of date. Fix these before App Review — reviewers read the privacy policy.
9. [ ] Merge. The `release` workflow builds, runs `migrate`, then deploys `api` and `web` (rolling).

## 2. Northflank environment (project `siffty`)

All flags live on the **`api` service** as service-level variables (they override `prod-secrets`, like `RUN_IN_PROCESS_SCHEDULER`). None of them is a secret. No `web` variable is needed — the frontend reads `GET /api/autodm/status`.

| Variable | Stage A (merge) | Stage B (owner testing) | Stage C (after approval) |
|---|---|---|---|
| `AUTODM_ENABLED` | `false` | `true` | `true` |
| `AUTODM_SCOPE_ALLOWLIST` | (unset) | your Siffty login email (+ the reviewer test user's email before submitting) | keep or clear |
| `AUTODM_SCOPE_ALL` | (unset) | (unset) | `true` |
| `AUTODM_POLL_MODE` | (unset) | `allowlist` (default) | `all`, or `off` once comment webhooks are proven |

After any change: **restart `api`** (Northflank → `api` → Restart; a variable change does not reach running pods). Confirm from the app, logged in: `GET https://api.siffty.com/api/autodm/status` → `enabled` mirrors `AUTODM_ENABLED`, and `available` is `true` only for an allowlisted login. (`src/cli/configCheck.js --expect` only accepts its own fixed list of keys, which does not include the `AUTODM_*` flags; adding them would touch an existing file, so it was left alone.)
`BACKEND_URL` must stay `https://api.siffty.com`: the main-message image URL Meta fetches is built from it.

## 3. Post-deploy smoke test (Stage A) — sorting is unchanged

Do this right after the merge deploys, with `AUTODM_ENABLED=false`.

1. `https://api.siffty.com/health` → ok. Within about an hour of the deploy (a 6-hour job's first scheduler tick), Admin → Health lists the new `autodm_cleanup` job with a successful run.
2. `api` logs: no `[autodm]` error lines. (With the flag off the only Auto DM activity is the cleanup job, which logs nothing when there is nothing to delete.)
3. Row counts only: `autodm_runs`, `autodm_automations`, `autodm_account_states`, `autodm_images` all exist and hold 0 rows.
4. **Sorting:** from a test Instagram account, DM a connected business account: `Hi, what's the price for one reel edit?`
   - It appears in the Siffty inbox within seconds (live).
   - It gets a category (e.g. pricing inquiry) — `aiStatus` becomes `completed`, never `autodm`.
   - Auto-reply behaves exactly as that tenant's reply mode says (sent in `smart`, not sent otherwise).
   - Admin → Health: webhook backlog 0, no stalled analyses.
5. **Connect flow:** as a normal user, start "Connect Instagram" and read the redirect URL (don't finish): `scope=instagram_business_basic,instagram_business_manage_messages` — nothing else.
6. As a normal user: no **Auto DM** in the sidebar; `GET /api/autodm/status` → `{"enabled":false,"available":false}`.

Then **Stage B**: set `AUTODM_ENABLED=true` + your email in `AUTODM_SCOPE_ALLOWLIST`, restart `api`, and **repeat step 4** (sorting must still be identical with the flag on). Then run `docs/autodm/MANUAL_TEST.md` against production with your tester accounts.

## 4. Rollback

| Symptom | Action |
|---|---|
| Anything wrong with Auto DM itself | Set `AUTODM_ENABLED=false` on `api` → **restart `api`**. Immediately inert: comment webhooks ignored, the DM seam returns false before any DB query, the loop idles, the API answers 404, the sidebar item disappears (within a minute / on reload). Nothing to undo in the database. |
| `api` pods crash-loop or fail to boot after the merge | Northflank → `api` → Deployments → **redeploy the previous build** (then re-enable CD later: see `OPERATIONS.md`). Do the same for `web` if needed. |
| Need the code out of `master` | Revert the merge commit through a PR. |
| Database | **Do not** drop or roll back the migration. The four tables are additive and old code never reads them; leaving them is safe. |
| Meta side | Nothing is required. With the flag off, comment/postback webhooks are stored, acknowledged and ignored. Optionally unsubscribe the `comments` field for your own account by reconnecting while the flag is off. |

## 5. Human Meta steps, in order

1. Merge + deploy with `AUTODM_ENABLED=false` (Stage A), so the updated Privacy Policy, Terms and data deletion page are live.
2. Fix the two pre-existing public-page inaccuracies (checklist item 8) and deploy.
3. App Dashboard → use case **Instagram API with Instagram Login** → Permissions → add `instagram_business_manage_comments` (Standard Access).
4. App Dashboard → Webhooks → Instagram → subscribe the app-level fields **`comments`** and **`messaging_postbacks`** (keep the existing ones).
5. App roles → Instagram testers: add your business account and 2–3 test accounts; accept each invite in the Instagram app.
6. Northflank: Stage B variables → restart `api`.
7. In Siffty (prod), reconnect your business account with the allowlisted login; approve comment access. The Auto DM page must show the builder, not "Reconnect".
8. Run `MANUAL_TEST.md` on production. If comment webhooks do not arrive (Standard Access), the poller (`AUTODM_POLL_MODE=allowlist`) still delivers within ~2 minutes — note which path worked.
9. Business verification in Meta Business Manager, if not already done (usually required for Advanced Access).
10. Create a reviewer test account: a Siffty user (verified email) connected to a tester Instagram account; add its email to `AUTODM_SCOPE_ALLOWLIST`; restart `api`.
11. Record the screencast (section 6) and submit App Review for **Advanced Access** to `instagram_business_manage_comments`.
12. After approval: Stage C (`AUTODM_SCOPE_ALL=true`, poll mode `all` or `off`), restart `api`, and ship the landing section if you held it back.

## 6. App Review draft — `instagram_business_manage_comments`

### Usage description (paste into the request)

> **How Siffty uses `instagram_business_manage_comments`.** Siffty is an inbox assistant for Instagram professional accounts. Its Auto DM feature lets the account owner set up a rule on their own posts or reels: when someone comments a keyword the owner chose (or any comment), Siffty receives the comment through the `comments` webhook and sends that commenter one private reply using the Instagram Private Replies API, with content the owner wrote — typically the link the commenter asked for. If the owner enables it, Siffty also posts one public reply under the comment. Siffty only acts on comments on the connected account's own media, sends at most one private reply per comment and one per person per automation, never replies to the account's own comments, and stays under Meta's limit of 750 private replies per hour per account. As a fallback for comments whose webhook did not arrive, Siffty reads recent comments on the posts the owner selected (`GET /{media-id}/comments`, the owner's own media only, last 72 hours). Comment data is used only to deliver the owner's reply, is never sent to any AI service, is never sold, and run logs are deleted after 90 days; all of it is deleted within 24 hours of disconnecting the account.
>
> *(Adapted from OpenReply's `META_APP_REVIEW.md`, MIT.)*

Related permissions already approved and unchanged: `instagram_business_basic` (identify the connected account, list its posts for the post picker) and `instagram_business_manage_messages` (the follow-up message with the link after the commenter taps the button or replies with the keyword; the follow check through the User Profile API).

### Screencast script (about 3 minutes, one take, narrated, production app)

1. **Log in** to `https://app.siffty.com` with the reviewer test account. *"This is Siffty, an inbox assistant for Instagram professional accounts."*
2. **Connect Instagram**: open the Auto DM page → **Reconnect Instagram**. Show the Instagram consent screen and point at the comment permission being granted. Return to Siffty; the Auto DM builder now appears.
3. **Create an automation**: Create automation → name "Free guide" → *Specific posts* → pick a recent post → trigger *Keywords*: `guide` → message: keep the opener, main text "Here is your guide", link `https://example.com/guide`, button "Open guide" → Options: leave the follow gate off, turn on one public reply "Sent you a DM!" → **Save & activate**. Show it in the list, Active.
4. **Comment on a second phone** (a tester account): comment `guide please` on that post.
5. **Show the result on the second phone**: the public reply "Sent you a DM!" under the comment, and the private reply in DM requests with the **Send me the link** button. Tap it; the link message with **Open guide** arrives. Tap it to show it opens.
6. **Back in Siffty**: open the automation's **Run log** — the row shows the commenter, the comment, status *Delivered*, and what was sent.
7. *(Optional)* **Desktop fallback**: on instagram.com, a second tester comments `guide`, then replies `LINK` in the DM; the link arrives.
8. **Poll-fallback option** — use this if comment webhooks are not being delivered to the app yet (Standard Access): before recording, confirm `AUTODM_POLL_MODE=allowlist` and the reviewer's email is on the allowlist. In step 4–5, say *"Siffty picks the comment up within about two minutes"* and wait on the Run log until the row appears (it is marked "found by polling"); the rest of the flow is identical.
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
- **Postbacks.** Whether `messaging_postbacks` must be subscribed per account could not be proven from the docs. It is added only to the allowlisted second subscribe call, with a retry without it. If button taps never arrive, the reply keyword (`LINK`) still works.
- **Opener timeouts.** If Meta delivers the opener but the response times out, the retry hits Meta's one-private-reply rule and the run ends `FAILED` although the person got the opener; their tap then falls to normal sorting.
- **Poller and autoscaling.** `api` runs 2–6 pods and each polls independently (runs dedupe in the database; Graph reads multiply by pod count). Fine for `allowlist`; for `all`, prefer `off` once webhooks are proven.
- **Admin re-subscribe.** The admin panel's "re-subscribe webhooks" sends the base fields only; for an allowlisted account it drops `comments` until the owner reconnects.
- **Desktop rendering.** Button templates may not render on Instagram desktop; the opener text names the reply keyword.
