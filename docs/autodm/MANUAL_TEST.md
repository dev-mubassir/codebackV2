# Auto DM — manual test on the dev tunnel

What automation cannot reach: Meta's real servers, a real phone, a real
desktop browser. About 30–40 minutes. Everything else is covered by the
backend suite (`tests/autodm-*.test.js`).

You need **three Instagram accounts**:
- **Business** — the professional account you connect to Siffty.
- **Fan A** — does NOT follow Business.
- **Fan B** — a second commenter (used for desktop and poller steps).

## 0. One-time setup (human steps)

1. Meta App Dashboard, for the app whose id is `INSTAGRAM_APP_ID` in `backend/.env`:
   1. Use case "Instagram API with Instagram Login" → Permissions: make sure `instagram_business_manage_comments` is added (Standard Access is enough for accounts with a role on the app).
   2. Webhooks → Instagram → subscribe the app-level fields **`comments`** and **`messaging_postbacks`** (keep `messages`, `message_reactions`, `messaging_seen`).
   3. App roles → Instagram testers: add **Business**, **Fan A** and **Fan B**, and accept the invites in each Instagram app (Settings → Website permissions → Tester invites). Without a role, Standard Access delivers no comment webhooks.
   4. The app must be **Live** (comment webhooks are not delivered in Development mode).
2. `backend/.env` (local only), then restart the backend:
   ```
   AUTODM_ENABLED=true
   AUTODM_POLL_MODE=allowlist
   ```
3. Admin panel `/admin/login` → **Auto DM**: set the rollout mode to **Beta** (reason + password), then grant your Siffty login email (it must already have signed up). *(Alternatively put your email in `AUTODM_SCOPE_ALLOWLIST` — it counts as a beta user while the mode is Beta.)*
4. Start everything as in `LOCAL_DEV.md` (database, backend, frontend, tunnel). Confirm `https://api.citykirana.in/health` answers from your **phone**.
5. Keep a log view open:
   ```bash
   cd C:\codeback\backend && npm start 2>&1 | grep -E "\[autodm\]|\[Webhook\]|\[Auth\]"
   ```

## 1. Connect with the comments scope

1. Log in to `https://app.citykirana.in` with the allowlisted email.
2. Reconnect Instagram (Dashboard → connect/reconnect) as **Business**. The consent screen must list comment access — approve everything.
3. **Expect:** log `[autodm] account <id>: comments scope granted, comments subscribed`. The sidebar shows **Auto DM** (reload once if the page was already open — the status is cached for a minute).
4. **If** the page shows "Reconnect Instagram to enable Auto DM", the comments scope was not granted — repeat step 2 and approve comment access.

## 2. Create an automation

Auto DM → **Create automation**:
- Post: **Specific posts** → pick one recent post (call it *the post*). Name: `Manual test`.
- Trigger: **Keywords** → `guide`; exclude words: `refund`.
- Message: keep the first message (it says "reply LINK"); main text `Here is the guide`; add a small JPG/PNG; link `https://example.com/guide`, label `Open guide`.
- Options: leave the follow gate **off** for now.
- **Save & activate** → it appears in the list, Active, all counts 0.

## 3. Keyword → opener → tap → link (phone)

1. As **Fan A**, comment `guide please` on the post.
2. **Expect** within ~5 s: log `run <id> queued (…, source webhook)` then `run <id>: opener sent`. Fan A gets a private reply (check DM **Requests**) with a **Send me the link** button. Run log: *DM sent*.
3. Tap **Send me the link**.
4. **Expect:** log `run <id>: GET tap accepted` → `main message delivered`. Fan A receives the image, then `Here is the guide` with an **Open guide** button that opens the link. Run log: *Delivered* ("First DM, Image, Link message").
5. **Inbox check:** Auto DM's own messages are NOT in the Siffty inbox (by design); the run log is where they show.

## 4. No match, exclude, duplicates, self

| Do | Expect |
|---|---|
| Fan B comments `nice video` | no run (log `comment …: no_match`) |
| Fan B comments `guide or refund` | no run (exclude word) |
| Fan A comments `guide` again | no second DM (one per person per automation; log `duplicate`) |
| Business replies to a comment | no run (`self`) |

## 5. Desktop LINK fallback

1. On a **computer**, log in to instagram.com as **Fan B**; comment `guide` on the post.
2. Open Fan B's DMs on the computer. The button may not render on desktop.
3. Type `LINK` and send.
4. **Expect:** log `GET tap accepted` → `main message delivered`; Fan B gets the link. In the Siffty inbox the `LINK` message appears but is **not sorted/classified** (it was handed to Auto DM).

## 6. Follow gate

Edit `Manual test` → Options → **Only send the link to followers** → Save changes. Use a fresh commenter (a new Fan, or delete the Fan's run by re-creating the automation).

**Not following (3 tries):**
1. Commenter who does not follow Business comments `guide`, taps **Send me the link**.
2. **Expect:** "Almost there! Follow this account first…" with an **I've followed** button. Run log: *Waiting for follow*, 1 follow check.
3. Tap **I've followed** twice more without following.
4. **Expect:** after the 3rd check the polite final message; run log *Not following*, 3 follow checks; no link was sent. A 4th tap does nothing.

**Follows:**
1. Another commenter comments `guide`, taps the button → gets the follow prompt.
2. Follow Business, tap **I've followed** (or reply `LINK`).
3. **Expect:** the link is delivered; run log *Delivered*.

(If Meta cannot tell whether someone follows, the link is sent anyway and the run log says "Follow status unavailable, so the link was sent anyway" — that is the intended fail-open.)

## 7. Sorting is untouched

1. From Fan A, send a normal DM: `Hi, what is your price for one reel?`
2. **Expect:** it lands in the inbox, gets its category as usual, and auto-reply behaves exactly as your reply mode says. No `[autodm]` line for it.

## 8. Poller fallback (missed webhook)

1. Stop the tunnel (Ctrl+C on cloudflared) so Meta's webhooks cannot reach you.
2. As a commenter with no run yet, comment `guide` on the post.
3. Start the tunnel again and wait up to ~2 minutes.
4. **Expect:** log `poller: 1 account(s), 1 new comment(s), 1 run(s) queued` (or the webhook arrives late via Meta's retries — either way **exactly one** run and one DM). The run log row says *found by polling* when the poller won.
5. The poller only looks at comments after the automation was last saved, within 72 hours, top-level only.

## 9. Revoke, mode off, kill switch

1. Admin → Auto DM → **Revoke** your grant. **Expect:** the sidebar item disappears (reload), `/autodm` redirects to the dashboard, a new `guide` comment does nothing, a pending run does not send; normal DMs are still sorted. Grant again → everything resumes (a pending run within ~5 minutes).
2. Set the mode to **Off** → same effect for everyone, within ~10 seconds.
3. Set `AUTODM_ENABLED=false` in `backend/.env`, restart the backend → the same, regardless of the admin settings.
4. Undo whichever you changed if you continue testing.

## 10. Clean up

- Delete the `Manual test` automation (its runs and image go with it).
- Remove the Fan accounts from Instagram testers if you no longer need them.
- For a disconnect test: disconnect Business in Siffty — its automations stop at once and their data is deleted by the `autodm_cleanup` job within 6 hours.
