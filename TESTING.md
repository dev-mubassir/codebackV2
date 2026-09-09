# Manual testing — the things automation cannot reach

Four flows need a real phone, a real Instagram account, and Meta's own servers.
Everything else is covered by `npm test` (16 files, 175 tests) and the
end-to-end walkthrough.

For each: **what to do**, **what should happen**, **what it means if it
doesn't**, and **the command to tail the log** so you can watch it happen
rather than reconstruct it afterwards.

---

## Before you start

```bash
cd C:\codeback\backend && npm start
```

In a second terminal, keep this open for all four tests:

```bash
cd C:\codeback\backend && npm start 2>&1 | grep -E "\[Auth\]|\[Webhook\]|\[Deauthorize\]|\[TokenHealth\]|\[Accounts\]"
```

And the tunnel, in a third:

```bash
cd C:\codeback && .\cloudflared.exe tunnel --config %USERPROFILE%\.cloudflared\config.yml run codeback
```

(`%USERPROFILE%\.cloudflared\config.yml` is cloudflared's default config
location, so it would find this file unaided — the flag is belt-and-braces,
not a path anyone must edit.)

`codeback` is a **locally-configured** tunnel — a connector started without
`--config` ignores `config.yml` and will not route. Confirm exactly one
process before continuing: `tasklist | findstr cloudflared`.

Confirm before proceeding: `https://api.citykirana.in/health` returns
`{"status":"ok"}` from your **phone**, not just your laptop. If it does not,
stop — every test below depends on it and you will otherwise be debugging the
tunnel while thinking you are debugging the app.

**Note on email:** password reset and verification will NOT be delivered until
`mail.siffty.com` is verified in Resend (see the report). Until then the
verification link is printed to the server console — search the log for
`[email:console] LINK:`. That is enough to complete every flow below.

---

## 0. The full signup walk — run this FIRST, once `mail.siffty.com` is verified

Everything below assumes a verified, connected account. This is how you get
one, and it is the path that was dead-ending with a blank screen.

**Blocked until DNS is in.** Until `mail.siffty.com` verifies, step 0.2 fails
with a 503 and the verification link only appears in the server console
(`[email:console] LINK:` — no, in fact it will *not*: with a key present the
Resend transport is used and simply fails, so watch for `[email] FAILED`).

### Do

1. **Register** at `https://app.citykirana.in/register` with a **fresh
   address** you can read — `mubassirs1999@gmail.com` is the one from the
   original repro. Use a password.
2. Watch the response. It now tells the truth either way:
   - `"Account created. Check your email to confirm your address."` — sent
   - `"Account created, but we couldn't send the confirmation email…"` — not sent
3. **Open the verification email** and click the link. It goes to
   `/verify-email?token=…`.
4. **Log in**, then click **Connect Instagram**.

### Expect

| Step | Expected |
|---|---|
| 0.1 register | 201, and `emailVerificationSent: true` |
| 0.2 email arrives | Subject "Confirm your email for Codeback", from `noreply@mail.siffty.com` |
| 0.3 click link | "Your email address is confirmed." |
| 0.4 connect Instagram | Redirects to Instagram — **not** bounced back to `/profile` |
| 0.5 after authorising | Lands on `/dashboard`, account connected |
| 0.6 trial | `TRIALING`, 3 days |

Confirm the trial:
```bash
cd C:\codeback\backend && node -e "require('dotenv').config();const p=require('./src/lib/prisma');p.subscription.findMany({select:{status:true,trialStartedAt:true,trialEndsAt:true}}).then(r=>{console.log(r);return p.\$disconnect()})"
```

### If you try to connect BEFORE verifying

This is the case that used to show a blank screen. It should now:

- **Not start OAuth at all.** The Connect button refuses up front and explains
  why, in place, with a link to your profile.
- If you reach `/profile?error=email_unverified` directly, the page renders the
  reason **and** a **Resend verification email** button, showing the address it
  will send to — so a typo at registration is visible and fixable.
- While the domain is unverified, that resend button reports the honest
  failure (`We could not send email just now…`) rather than claiming success.

### If it fails

| Symptom | Meaning |
|---|---|
| Registration says it couldn't send | Domain still unverified. Check `[email] FAILED` in the log for the verbatim Resend error. |
| Connect button does nothing and shows no message | The pre-redirect guard fired but the banner did not render — report it, that is a UI regression. |
| Bounced to `/profile` with a blank page | The `?error=` rendering regressed. 19 codes are mapped in `content/copy.js` under `errors.oauthCallback`. |
| Connected but no trial | Check `emailVerifiedAt` is set. The trial is refused without it by design. |

---

## 1. Mobile Instagram OAuth across a browser switch

**This is the one that structurally could not work before.** State used to live
in the session, addressed by a cookie. Your phone bounces Brave → Instagram's
in-app browser → Chrome, which is three separate cookie jars, so the callback
arrived with no session and therefore no state and no identity. The state token
is now self-contained and HMAC-signed, so the user id travels inside it.

### Do

1. On your **phone**, open `https://app.citykirana.in` in **Brave** (or any
   browser that is not your default).
2. Log in with a verified account.
3. Tap **Connect Instagram**.
4. Let it hand off to the Instagram app / in-app browser and authorise there.
5. Let it land wherever it lands — **do not** manually copy the URL back into
   Brave. The point is to let the OS route the callback to your default
   browser.

### Expect

- You end on `/dashboard` with the account connected.
- The account appears in the dashboard with your Instagram handle.
- Log shows, in order:

```
[Auth] Redirecting to Instagram OAuth
[Auth] Received authorization code, exchanging for token...
[Auth] Instagram connect complete. Redirecting to dashboard.
```

### If it fails

| Log line | Meaning |
|---|---|
| `Rejected Instagram callback: state bad_signature` | `OAUTH_STATE_SECRET` differs between the process that minted the state and the one that received it. Did you restart the server mid-flow? |
| `Rejected Instagram callback: state expired` | The state token is 10 minutes old. Slow 2FA can genuinely hit this. Retry; if it recurs, the TTL needs raising. |
| `Rejected Instagram callback: state replayed_or_unknown_nonce` | The nonce was already consumed — you completed the flow twice, or hit Back and resubmitted. Expected behaviour, not a bug. |
| `state wrong_purpose` | A Google-flow token reached the Instagram callback. Should be impossible; report it. |
| Redirect to `?error=login_required_to_connect` | The signed state carried no user id. Means the connect was started logged-out — which is now refused by design. |
| Redirect to `?error=missing_scopes` | You unticked a permission on Instagram's consent screen. Retry and accept both. |

**The specific thing to watch for:** if it fails with `invalid_oauth_state` on
a browser switch but succeeds when you stay in one browser, the signed-state
change has regressed and it is back to being session-bound.

---

## 2. Deauthorize callback

**Brand new code that has never seen a real Meta payload.** `grep -ri deauth`
over the repo returned nothing before this branch — Meta asks for this URL
alongside the data-deletion one, and it did not exist.

### Before you start

Register the URL in the Meta dashboard (App → Instagram → Webhooks/Settings):

```
Deauthorize Callback URL:  https://api.citykirana.in/data-deletion/deauthorize
```

### Do

1. Connect Instagram (test 1).
2. Note the ledger row survives — run this and keep the output:
   ```bash
   cd C:\codeback\backend && node -e "require('dotenv').config();const p=require('./src/lib/prisma');p.instagramIdentity.findMany({select:{igUserIdHash:true,trialConsumedAt:true,linkCount:true}}).then(r=>{console.log(r);return p.\$disconnect()})"
   ```
3. On Instagram: **Settings → Website permissions / Apps and websites →
   Codeback → Remove**.

### Expect

- Log shows: `[Deauthorize] Disconnected 1 account(s) after deauthorization.`
- The account shows as disconnected in your dashboard.
- **Your conversation history is still there.** Deauthorization is not a
  deletion request; removing an app permission must not erase message history.
- The `[email:console] LINK:` block shows a "reconnect" email (it will not be
  delivered until the domain is verified).
- Re-run the ledger command from step 2: **the row is unchanged**, including
  `trialConsumedAt`.

### If it fails

| Symptom | Meaning |
|---|---|
| Nothing in the log at all | Meta never called it. The URL is not registered, or the tunnel was down. Check the Meta dashboard's webhook delivery log. |
| `Rejected request: missing or invalid signed_request` | `INSTAGRAM_APP_SECRET` does not match the app that sent it. Most likely you are pointed at the wrong Meta app. |
| Account still shows CONNECTED | The callback 200'd but matched no row — check the `igUserId` in the payload against your `instagram_accounts` row. |
| History disappeared | **Report this immediately.** Deauthorize must disconnect, never delete. |

Meta retries this callback, so an error here will repeat. Watch for a second
identical log block.

---

## 3. Real DM, end to end

### Do

1. With Instagram connected, send a DM to the connected account **from a
   different Instagram account** (not the connected one — your own messages are
   echoes and are deliberately ignored).
2. Watch the log.
3. Optionally enable auto-reply first: Settings → set reply mode to `smart`.

### Expect

```
[Webhook] ... (signature verified, 200 returned immediately)
[messageAnalysisJob] ... classification
```

- The message appears in your inbox within a few seconds.
- It gets a category and a priority.
- If auto-reply is on and the trial is active, a reply is sent.

### Then confirm no duplicate on Meta's retry

Meta retries deliveries it thinks failed. To force the case:

```bash
cd C:\codeback\backend && node -e "
require('dotenv').config();const p=require('./src/lib/prisma');
p.webhookDelivery.count().then(c=>{console.log('delivery rows:',c);return p.message.count()}).then(m=>{console.log('messages:',m);return p.\$disconnect()})"
```

Send another DM, re-run, and confirm both counts rise by exactly one. If Meta
retries on its own, `delivery rows` stays flat and the log shows:

```
[Webhook] Duplicate delivery ignored (idempotency hit).
```

### If it fails

| Symptom | Meaning |
|---|---|
| `Rejected request: invalid or missing X-Hub-Signature-256` | `INSTAGRAM_APP_SECRET` is wrong for this app. |
| `No account found for IG User ID: …` | The `igUserId` stored at connect differs from the one Meta sends as `entry.id`. This is the field-fallback risk noted in FINDINGS — report the two values. |
| Message arrives but never classified | Check `aiStatus`. `skipped` means the trial expired (correct). `failed` means the AI provider errored. `pending` forever means the queue is not draining. |
| Auto-reply does not fire | Expected unless reply mode is explicitly `smart` — it is opt-in and fails closed by design. |

---

## 4. Reconnect after deauthorize — no second trial

**This is the anti-abuse property.** The ledger has no relation to the user
precisely so that disconnecting, deauthorizing, or deleting the account cannot
reset a consumed trial.

### Do

1. After test 2 (deauthorized), record the subscription:
   ```bash
   cd C:\codeback\backend && node -e "require('dotenv').config();const p=require('./src/lib/prisma');p.subscription.findMany({select:{status:true,trialStartedAt:true,trialEndsAt:true}}).then(r=>{console.log(r);return p.\$disconnect()})"
   ```
2. Reconnect the same Instagram account, on the same user.
3. Re-run the command.

### Expect

- The connect succeeds and history reappears.
- `trialStartedAt` and `trialEndsAt` are **unchanged** — no new trial.
- The ledger's `linkCount` has incremented.
- The log does NOT show a trial grant.

### The harder case, if you want to be thorough

Delete your Codeback account entirely (`Profile → Delete account`), register a
brand new one, verify its email, and connect the **same** Instagram account.

Expected: the connect succeeds, and **no trial is granted**. The ledger row
survived the deletion, which is the whole point of it having no foreign key to
the user.

### If it fails

| Symptom | Meaning |
|---|---|
| A new trial IS granted on reconnect | `trialConsumedAt` was not stamped, or `IG_IDENTITY_PEPPER` changed between the two connects. **A changed pepper makes every ledger row unmatchable** — check it is identical to what it was at first connect. |
| Connect refused with `account_already_connected` | A stale `CONNECTED` row still exists for that Instagram account. Expected if you connected it to a second Codeback user; disconnect there first. |
| Ledger row missing entirely after account deletion | Serious — it means the row is cascading with the user, which defeats the entire anti-abuse design. Report immediately. |

---

## Quick reference — all the log tails

```bash
# Everything relevant, one stream
cd C:\codeback\backend && npm start 2>&1 | grep -E "\[Auth\]|\[Webhook\]|\[Deauthorize\]|\[TokenHealth\]|\[Accounts\]|\[email"
```

```bash
# Just the email links, while the sending domain is unverified
cd C:\codeback\backend && npm start 2>&1 | grep -A 2 "email:console"
```

```bash
# Just OAuth state decisions
cd C:\codeback\backend && npm start 2>&1 | grep -E "state |Rejected"
```
