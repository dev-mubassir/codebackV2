# Deployment

Every environment variable this application reads, what it is for, how to
generate it, and whether it is required.

**Before your first deploy of this branch, read the DEPLOYMENT PREREQUISITE
section at the top of `FINDINGS.md`.** Production is assumed to carry the same
migration drift the local database did, and `prisma migrate deploy` may behave
differently there than it does locally.

---

## Required in every environment

The server **refuses to boot** without these. That is deliberate: each one
fails silently and late if it is merely absent, which is far worse than failing
at startup with its name printed.

| Variable | Purpose | Generate |
|---|---|---|
| `DATABASE_URL` | Postgres connection string. Also backs session storage. | From your provider. |
| `SESSION_SECRET` | Signs session cookies. Minimum 32 characters. | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key encrypting Instagram access tokens at rest. **Must be exactly 32 bytes of hex (64 chars).** | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `OAUTH_STATE_SECRET` | HMAC key signing the OAuth state token, for both Instagram and Google. | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `IG_IDENTITY_PEPPER` | HMAC key for the trial-abuse ledger. **See the warning below.** | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

### ⚠ `IG_IDENTITY_PEPPER` can never be rotated

Every row in `instagram_identities` stores `HMAC(igUserId, this key)`. Change
the key and every stored hash becomes unmatchable — which does not throw an
error, it simply hands **every past trial user a brand new trial** and makes
the anti-abuse ledger silently worthless.

**Back it up somewhere permanent before this system sees real users.** It is
the one secret here that cannot be recovered by regenerating it.

### Rotation notes for the others

- `SESSION_SECRET` — safe to rotate. Set the outgoing value as
  `SESSION_SECRET_PREVIOUS` first; the secret is passed as an array so old
  cookies stay valid until they expire instead of logging everyone out at once.
- `TOKEN_ENCRYPTION_KEY` — rotating invalidates every stored Instagram token.
  `token_key_version` exists so a future rotation can be staged (add a v2 key
  in `lib/crypto.js` `getKey()` and leave v1 in place), but that path has not
  been exercised. Today, rotating means every user must reconnect.
- `OAUTH_STATE_SECRET` — safe. The only cost is that OAuth attempts already
  in flight fail; the user retries and it works.

---

## Required in production specifically

| Variable | Purpose | Notes |
|---|---|---|
| `NODE_ENV=production` | Enables secure cookies, HSTS, and every fail-closed gate. | **Undocumented previously and easy to miss.** Without it the app runs with production safeguards relaxed and only prints a warning. |
| `INSTAGRAM_APP_SECRET` | Verifies webhook signatures and Meta `signed_request` payloads. | Server exits if unset in production. |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of the admin password. | Required if `ADMIN_USERNAME` is set. Generate: `node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'your-password'` |
| `ADMIN_PASSWORD` | **Must be UNSET.** | The server refuses to start if this is present in production. An admin session can impersonate any tenant, so a plaintext password in an env var is a master key to every customer's DMs. |

---

## Instagram / Meta

| Variable | Required | Purpose |
|---|---|---|
| `INSTAGRAM_APP_ID` | Yes (for OAuth) | Meta app id. |
| `INSTAGRAM_APP_SECRET` | Yes | Token exchange, webhook signatures, `signed_request` verification. |
| `REDIRECT_URI` | Yes | Must match the Meta dashboard entry **exactly**, no trailing slash. |
| `WEBHOOK_VERIFY_TOKEN` | Yes | Meta's subscription handshake. Any string; treat it as a secret. **The GET handshake now returns 503 if this is unset**, rather than accepting `undefined === undefined`. |
| `SKIP_SIGNATURE_VERIFICATION` | No | Development only. The server **exits** if this is `true` in production. |

**Meta dashboard URLs** — all three must be registered:

- Webhook callback: `${BACKEND_URL}/webhooks/instagram`
- Data deletion callback: `${BACKEND_URL}/data-deletion/instagram`
- Deauthorize callback: `${BACKEND_URL}/data-deletion/deauthorize` ← **new; did not exist before this branch**

---

## Google OAuth

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Optional | Google sign-in. If unset, the button reports "not configured" rather than failing oddly. |
| `GOOGLE_CLIENT_SECRET` | Optional | As above. |

**There is deliberately no `GOOGLE_REDIRECT_URI`.** The callback URL is derived
from `BACKEND_URL` as `${BACKEND_URL}/auth/google/callback`, so the public base
URL is configured in exactly one place. Register that URI in the Google Cloud
Console.

Scopes are `openid`, `email`, `profile` and nothing else — these are
non-sensitive, so Google's app verification review is not triggered. **Adding
any other scope changes that.**

Note for local development: Google rejects the reserved `.test` TLD, and this
server serves HTTPS locally with a certificate covering only
`local.codeback.test`. Local Google testing therefore has to go through the
tunnel hostname, not `localhost`.

---

## Email

| Variable | Required | Purpose |
|---|---|---|
| `RESEND_API_KEY` | Recommended | Sends password-reset and verification email. **If unset, the app falls back to a console transport that logs the full link** — fine locally, silently broken in production. A warning is printed at boot in production if it is missing. |
| `FROM_EMAIL` | Recommended | Sending address. Defaults to `noreply@mail.siffty.com`. Use a `mail.` subdomain so a deliverability problem cannot contaminate the root domain. |
| `REPLY_TO_EMAIL` | Optional | Where replies go. Falls back to `SUPPORT_EMAIL`. |
| `SUPPORT_EMAIL` | Optional | Shown in email footers. Defaults to `support@siffty.com`. |

SPF, DKIM and DMARC must be configured on the sending domain. Without them,
reset emails land in spam and you will spend a day debugging application code
that works correctly.

---

## URLs

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `FRONTEND_URL` | Yes | `http://localhost:3000` | OAuth redirects, reset/verification links, Socket.io CORS, and the CORS allowlist. |
| `BACKEND_URL` | Yes | — | The public base URL. Feeds the CORS allowlist and derives the Google redirect URI. |
| `ALLOWED_ORIGINS` | Optional | — | Extra comma-separated browser origins beyond `FRONTEND_URL`/`BACKEND_URL`. |
| `PORT` | Optional | `5000` | |
| `COOKIE_SAMESITE` | Optional | `lax` | Only change if the frontend and backend are on unrelated domains — and note `none` also requires `Secure`, so setting it outside production silently breaks sessions entirely. |

---

## Optional

| Variable | Purpose |
|---|---|
| `SESSION_SECRET_PREVIOUS` | Outgoing session secret during a rotation. |
| `REDIS_URL` | Session store and job queue. **Currently unused** — sessions are Postgres-backed and the queue is in-process. The Redis path remains in the code, dormant, and is preferred if set. |
| `AI_PROVIDER` | Defaults to `gemini`. |
| `GEMINI_API_KEY` | AI classification. Absent, the app degrades gracefully: messages still arrive and persist, classification falls back to `other`. |
| `OPENAI_API_KEY`, `GROK_API_KEY`, `XAI_API_KEY` | Failover providers in `aiService.js`. |
| `ADMIN_USERNAME`, `ADMIN_EMAILS` | Admin panel access. `ADMIN_EMAILS` now matches only **verified** email addresses — Instagram usernames are no longer accepted, because a handle is mutable and externally controlled. |

---

## Frontend

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | **Yes** | The entire frontend→backend wiring. Defaults to `http://localhost:5000`, so a deploy that omits it **builds fine and then cannot reach the API**. |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | **Yes** | Shown on `/privacy`, `/terms`, `/data-deletion`. The production build **throws** if unset. |

---

## Deploy sequence

1. **Read the DEPLOYMENT PREREQUISITE section in `FINDINGS.md`** and run
   `backend/scripts/prod-readonly-survey.js` against production. It is
   SELECT-only. If it reports phantom migrations, work through the cleanup
   before anything else.
2. Set every required variable above. Back up `IG_IDENTITY_PEPPER`.
3. `npx prisma migrate deploy`. The auth-hardening migration asserts its own
   preconditions and aborts the whole transaction rather than applying
   partially, so a failed attempt leaves the database unchanged.
4. Run `node scripts/backfill-token-encryption.js` (report only), then
   `--apply`. It encrypts any remaining plain-text tokens and then **decrypts
   every row from the new columns** to prove they are correct — a non-null
   check alone does not.
5. Register the three Meta dashboard URLs, including the **new deauthorize
   callback**.
6. Verify: boot the server and confirm it logs the Postgres session store, then
   check the webhook handshake from the Meta dashboard.

### Not yet done — see `FINDINGS.md` D3

`instagram_accounts.access_token` and the plain-text passthrough in
`lib/crypto.js` are still in place. They may only be removed after the backfill
is verified complete in **every** environment, production included. That is a
separate, later migration; removing them early ships ciphertext to Meta.
