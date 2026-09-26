# Production environment — project `siffty` (asia-south-delhi)

Every variable the backend (`backend/src`) and frontend (`frontend/src`, `next.config.mjs`) read, audited against the code on 2026-09-26.
**No values here, only names and non-secret recommendations.** Check what is actually set with `node src/cli/configCheck.js`, which prints statuses only.

Legend: **Req** = the API refuses to boot, or the feature breaks, without it. **Match old** = must be identical to the old `codeback` project's value.

## Backend — group `prod-secrets` (api + migrate)

| Variable | Purpose | Req | Secret | Match old | Recommended production value |
|---|---|---|---|---|---|
| `NODE_ENV` | production mode: Secure cookies, strict boot checks, Cashfree default | yes | no | – | `production` ✅ (already set) |
| `PORT` | listen port | no | no | – | set by the service (`5000`) |
| `DATABASE_URL` | Postgres URL. Linked from the addon, but **replaced at boot** by the URL built from `DB_*` (the HA `POSTGRES_URI` isn't Prisma-parseable) | yes | yes | no (new DB) | linked, never typed |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | parts of the HA primary connection (`lib/dbUrl.js`) | yes | yes | no | linked from addon `postgres` ✅ |
| `DB_SSLMODE` | sslmode for the built URL | no | no | – | unset (`require`) |
| `DB_POOL_SIZE` | Prisma connections per instance | no | no | – | **`8`** — measured `max_connections` = 750 (747 usable). Worst case 6 × (8 + 2 + 1 + 2) + 7 = 85 → 89 % headroom |
| `REDIS_URL` | BullMQ, socket adapter, rate limits, email quota | yes (for >1 instance) | yes | no | linked from addon `redis` ✅ |
| `REDIS_TLS_INSECURE` | skip Redis certificate verification | no | no | – | **unset / `false`** (currently `false` ✅) |
| `SESSION_SECRET` | signs session cookies (≥ 32 chars; the API won't boot without it) | yes | **yes** | **YES**: otherwise every user is logged out at cutover | 🧑 copy exactly |
| `SESSION_SECRET_PREVIOUS` | accepted old signing secret during a rotation | no | yes | yes if set | 🧑 copy only if the old project has it |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM for stored Instagram tokens (64 hex) | yes | **yes** | **YES**: otherwise no token decrypts (self-check) | 🧑 copy exactly |
| `IG_IDENTITY_PEPPER` | HMAC pepper for the trial-abuse ledger | yes | **yes** | **YES**: otherwise ledger hashes don't match (self-check) | 🧑 copy exactly |
| `OAUTH_STATE_SECRET` | HMAC for OAuth `state` | yes | yes | yes (else logins mid-flight at cutover fail) | 🧑 copy exactly |
| `FRONTEND_URL` | CORS/CSRF allowlist, links in emails, Socket.io origin | yes | no | same value | `https://app.siffty.com` ✅ |
| `BACKEND_URL` | CORS allowlist, Google OAuth callback base | yes | no | same value | `https://api.siffty.com` ✅ |
| `ALLOWED_ORIGINS` | extra CORS origins | no | no | – | **unset**. Confirmed: the allowlist is `FRONTEND_URL` + `BACKEND_URL` without it (`lib/security.js:26-33`); extra origins only widen CORS/CSRF |
| `COOKIE_SAMESITE` | session cookie SameSite | no | no | – | **unset** (`lax`). `app.` and `api.` are same-site; `none` would need CSRF tokens |
| `TRUST_PROXY` | proxy hops for `req.ip` / HTTPS detection | no | no | – | **unset** (default 1 hop). Verified 2026-09-26: `req.ip` = the client's public IP behind Northflank's ingress. Keep the `api`/`app` DNS records DNS-only; a Cloudflare proxy would add a hop |
| `INSTAGRAM_APP_ID` | Meta app | yes | no (ID) | **YES** (same Meta app) | 🧑 copy |
| `INSTAGRAM_APP_SECRET` | Meta webhook signatures + OAuth | yes | **yes** | **YES** | 🧑 copy |
| `WEBHOOK_VERIFY_TOKEN` | Meta webhook subscription handshake | yes | yes | **YES** (as configured in the Meta app) | 🧑 copy |
| `REDIRECT_URI` | Instagram OAuth redirect (registered in Meta) | yes | no | **YES, exactly** | 🧑 copy |
| `GOOGLE_CLIENT_ID` | Google sign-in | yes | no (ID) | yes | 🧑 copy |
| `GOOGLE_CLIENT_SECRET` | Google sign-in | yes | **yes** | yes | 🧑 copy |
| `RESEND_API_KEY` | email. **Required in production**: without it (and without `EMAIL_DRY_RUN=true`) the API refuses to boot | yes | **yes** | yes (same domain) | 🧑 copy |
| `FROM_EMAIL` | sender | no | no | yes | `noreply@mail.siffty.com` (the code default; set it explicitly) |
| `REPLY_TO_EMAIL` | reply-to | no | no | yes | the support mailbox, or unset (falls back to `SUPPORT_EMAIL`) |
| `SUPPORT_EMAIL` | contact/enterprise enquiries, billing alerts go here | yes (contact form 503s without it) | no | yes | **business**: your support inbox |
| `EMAIL_DAILY_CAP` | daily send cap (default 80, under Resend free 100/day) | no | no | – | unset while on Resend free; **raise if you have a paid Resend plan** (business) |
| `EMAIL_CRITICAL_RESERVE` | sends reserved for resets/verification (default 20) | no | no | – | unset |
| `EMAIL_DRY_RUN` | send nothing (staging only) | no | no | – | **`false`: set as a SERVICE-LEVEL variable on `api`** since the cutover (it overrides the group, which still says `true`). Never remove it |
| `GEMINI_API_KEY` | AI classification/replies (the default provider) | yes (else AI degrades to "other") | **yes** | yes | 🧑 copy |
| `OPENAI_API_KEY` `ANTHROPIC_API_KEY` | optional alternate providers | no | yes | – | **not needed**. Confirmed: boot doesn't read them; a provider without a key simply can't be selected in the admin panel (`lib/ai/models.js:61-68`) |
| `AI_MOCK` | fake AI for local tests | **must NOT exist** | – | – | absent (configCheck fails if set in production) |
| `BILLING_ENABLED` | master billing switch: billing routes, Cashfree webhook, billing jobs, entitlement enforcement | yes | no | – | **business**: `true` if you sell from day one (you added live keys, so presumably `true`). The admin kill switch `enforce_subscriptions` overrides it at runtime |
| `META_APPROVED` | shows the "official Instagram Graph API" trust badge on pricing | no | no | yes | **business**: `true` only once Meta App Review has approved the app |
| `USD_PRICING_ENABLED` | shows USD/INTL prices and the currency toggle; **enforced at checkout** (INTL orders get 409 `INTL_PRICING_DISABLED` while off) | no | no | – | **`false`: INR-only launch.** The live Cashfree account refused a USD order on 2026-09-26 ("order Currency not enabled"). Turn it on only after Cashfree enables USD, and restart `api` |
| `CASHFREE_ENV` | `sandbox` or `production` API host (unset + `NODE_ENV=production` means LIVE) | yes | no | – | **`production`** (currently `sandbox`: 🧑 change it) |
| `CASHFREE_APP_ID` | Cashfree app | yes (if billing) | no (ID) | no (you entered production) | ✅ entered |
| `CASHFREE_SECRET_KEY` | Cashfree API + **webhook signature key** | yes (if billing) | **yes** | no | ✅ entered (configCheck verifies it's a production key when `CASHFREE_ENV=production`) |
| `WEBHOOK_TIMESTAMP_ENFORCE` | reject Cashfree webhooks outside ±5 min | no | no | – | **`false`/unset** until retry timestamps are verified |
| `RUN_IN_PROCESS_SCHEDULER` | scheduled jobs on | no | no | – | **`true`: set as a SERVICE-LEVEL variable on `api`** since the cutover (overrides the group's `false`). Never remove it |
| `SKIP_SIGNATURE_VERIFICATION` | dev-only escape hatch | – | – | – | absent (refused in production) |

## Frontend — group `web-build-args` (web, build time)

| Variable | Purpose | Req | Match old | Recommended value |
|---|---|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | every API/socket call (the build fails if unset or localhost) | yes | same | `https://api.siffty.com` ✅ |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | printed on privacy/terms/data-deletion (the build fails if unset) | yes | **yes** | ✅ filled by you |
| `NEXT_PUBLIC_CASHFREE_MODE` | Cashfree JS mode; must equal the backend `CASHFREE_ENV` | yes (if billing) | – | **`production`** (currently `sandbox`: 🧑 change it; takes effect at the next `web` build) |
| `NEXT_PUBLIC_BUSINESS_CITY` | shown on /contact | no | yes | ✅ filled by you |
| `NEXT_PUBLIC_SITE_URL` | `metadataBase` for Open Graph | no | – | `https://app.siffty.com` ✅ |
| `PORT`, `HOSTNAME` | runtime listen address (Dockerfile defaults) | – | – | defaults |

## Why the agent does not write values

Northflank's secret-group PATCH **replaces the whole variable map**. A probe on a throwaway group kept only the patched key. Writing even one non-secret value through the API would therefore delete every secret in the group, so all value changes are listed for the owner to make in the UI.
