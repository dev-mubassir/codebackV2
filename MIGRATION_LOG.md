# Scale-up log — `scale-prod`

Source of truth for moving Siffty to a new, autoscaled Northflank project close to India. **Read this first in a new session.**
No secrets in this file: names only.

## Plan in one paragraph

Build a new Northflank project `siffty` in **`asia-south-delhi`** (GCP `asia-south2`, Delhi) with production resources only:
- `api` (autoscaling 2–6)
- `web` (autoscaling 1–3)
- Postgres 18 with HA (2 replicas, Patroni failover)
- Redis
- a `migrate` job
- a `release` workflow on `master`

Cut over from the old project `codeback` (`us-central`) in one short maintenance window (Gate 4).
There is no staging environment. Pre-production testing runs on the owner's dev machine (local Docker, dev data).

History: GCP-direct (Gate 1) and Northflank BYOC (Gate 1b) were rejected on cost. In-place scaling in `codeback` (Gate 2) was superseded by the region move (Gate 2b).

## Gate status

| Gate | State |
|---|---|
| 1, 1b | done |
| 2 — code (Redis state, adapter, scheduler, ops hardening) | committed and pushed on `scale-prod` (2026-09-25) |
| 2b — new project, zero missed DMs, isolation, AI mock | committed and pushed (2026-09-25) |
| 3 — F2/F3, self-check, dev-machine tests, runbook | committed and pushed (2026-09-26) |
| 3b — env audit, config check, guards, rehearsal, short-cutover runbook | committed and pushed (2026-09-26) |
| 3c — final blockers (IG connect, USD, email quota, config) | **GO/NO-GO report delivered; batch waiting for approval** |
| 4 — cutover + cleanup | — |

## Facts established

- The old prod Postgres (`codeback-postgres`) is **v18**. The final dump needs `postgres:18-alpine`.
- The old services build with Heroku buildpacks from `dev-mubassir/codebackV2` (the same repo as the local `origin`, whose account was renamed).
- Northflank managed regions include **Asia - South - Delhi** (`asia-south-delhi`).
- Northflank Postgres HA: Patroni with automatic failover; the connection string follows the primary.
- A Northflank addon import/restore **replaces every database in the addon**. It's only allowed on the new, empty production addon at cutover.
- Northflank Redis: AOF persistence, minimum 4 GB disk, `maxmemory-policy` fixed at creation (`noeviction`).
- The Northflank API silently drops `dockerfileTarget`, so the migrate job uses its own `backend/Dockerfile.migrate`.
- Workflow node shapes that work (found by probing):
  - `Build {id, type: service|job, branch}`
  - `JobRun {jobId}`
  - trigger `vcs-push` with `branchNamePatterns`

  There is no "deploy build" node. Builds deploy through service CD.

## Resources — project `siffty` (asia-south-delhi)

| Resource | Size | State |
|---|---|---|
| addon `postgres` | PG 18, nf-compute-50, 10 GB nvme, **2 replicas (HA)**, TLS, daily snapshot 21:30 UTC (03:00 IST) kept 7 days | running |
| addon `redis` | nf-compute-50, 4 GB, TLS, `noeviction` | running |
| service `api` | nf-compute-50, port 5000, readiness `/health`, liveness `/livez`, CI off / CD on | **0 instances**, no build yet |
| service `web` | nf-compute-20, port 3000, readiness/liveness `/` | **0 instances**, no build yet |
| job `migrate` | nf-compute-20, `backend/Dockerfile.migrate` | no build yet |
| secret group `prod-secrets` | api + migrate; links `postgres` → `DATABASE_URL`, `redis` → `REDIS_URL` | **owner fills values** |
| secret group `web-build-args` | web only; `NEXT_PUBLIC_*` build args | owner fills 2 values |
| workflow `release` | trigger: push to `master` → build+run `migrate` → build `api` + `web` in parallel (CD deploys) | created |

Autoscaling is applied at cutover. Enabling it now starts the minimum instance count.
- api: min 2, max 6, CPU 70%, memory 80%
- web: min 1, max 3, CPU 70%, memory 80%

Specs: `deploy/northflank/*.json`.

### Temporary / to clean up
| Item | Where | Note |
|---|---|---|
| workflows `probe*` | project `siffty` | deleted by the owner (2026-09-25) |
| local stack `deploy/local` (api1, api2, lb, redis) + `siffty-dev-pg18` (:55434) | dev machine | Gate 3 tests; `docker compose -f deploy/local/docker-compose.yml down` + `docker rm -f siffty-dev-pg18` |
| local DB `siffty_shadow` in `codeback-pg` | dev machine | shadow DB for `prisma migrate diff` |
| local images `siffty-api-local`, `siffty-migrate-local` | dev machine | |
| local Docker `siffty-test-redis` | dev machine | test-suite Redis (:56379) |
| local Docker `siffty-test-pg18` (stopped) | dev machine | one PG 18 suite run |
| local DBs `siffty_smoke`, `siffty_smoke2` in `codeback-pg` | dev machine | image smoke tests |
| local images `siffty-api-test`, `siffty-migrate-test` | dev machine | |

| secret group `tmp-patch-probe` | project `siffty` | 2026-09-26: proved PATCH replaces all variables; dummy values, no restrictions (applies to nothing). **Deletion needs owner approval** |

**Deleted on 2026-09-25 (old project `codeback`):** `stg-postgres`, `stg-redis`, `stg-secrets`, tag `stg`, subdomains `new-api` and `new-app`. Old production is untouched.

## Connection budget (6 API instances)

Per API instance: Prisma 3 + user-session pool 2 + admin-session pool 1 + scheduler lock pool 2 = **8**.
These are code defaults; `DB_POOL_SIZE` overrides the Prisma share.

| | connections |
|---|---|
| 6 × 8 | 48 |
| `migrate` job | 2 |
| ad-hoc | 5 |
| **worst case** | **55** |
| Postgres default `max_connections` 100, 3 reserved | 97 usable → **43% headroom** |

**To verify in Gate 3:** read the real `max_connections` from the running API during the smoke test.

## Cost — project `siffty` (list prices; region pricing assumed equal to the published list)

| Item | $/mo |
|---|---|
| api nf-compute-50 × 2 (minimum) | 24.00 |
| web nf-compute-20 × 1 | 5.40 |
| Postgres nf-compute-50 × 2 replicas + 2 × 10 GB | 27.00 |
| Redis nf-compute-50 + 4 GB | 12.60 |
| Builds, backups, migrate runs, egress | ≈ 3.50 |
| **Normal load** | **≈ 72.50** |
| Spike: each extra api instance | +12.00 if sustained all month (pro-rated per second) |
| Spike: each extra web instance | +5.40 if sustained |
| **Ceiling (6 api + 3 web all month)** | **≈ 131** |

The old project `codeback` keeps billing until the owner deletes it, 7 days after cutover.

## Decisions (approved)

Gate 2: D1, D3, D4, `EMAIL_DRY_RUN`, `RUN_IN_PROCESS_SCHEDULER`, log-only Cashfree timestamp window, D9, D7. `REDIS_TLS_INSECURE` stays false in prod. Postgres 18 everywhere.
Gate 2b: Delhi region, no staging, autoscaling as above, zero-missed-DM design, strict isolation, `AI_MOCK` for local only.

## Gate 3 results (2026-09-26, local Docker: 2 API containers + nginx + Redis + Postgres 18 dev copy)

| Test | Result |
|---|---|
| Boot logs (both containers) | redis adapter, bullmq, sandbox, dry-run, AI mock, scheduler ON |
| Burst: 2,000 signed webhooks, api2 restarted mid-burst | 2000/2000 stored, 0 duplicates, 0 unprocessed; 19 retries (502/503 during restart) |
| Redis down 5 min under traffic (run 1) | **found a crash**: both containers restarted twice (unhandled ioredis rejection from the socket adapter publish, plus BullMQ `error` events without listeners). No DM lost: 1540/1540 after the recovery sweep |
| Redis down 5 min (run 2, after the fix) | 1738/1738 stored, 0 duplicates, `/health` 107/107 OK, 0 restarts, `redis_down` alert fired |
| Isolation over HTTP through the LB (both containers) | 10/10 rounds: B blocked from A's conversation, A's data absent from B's list |
| k6 spike 20 → 150 → 0 | 0.00 % errors (23,036 requests), p95 495.8 ms (< 500, little margin, laptop 1 CPU per container), 0 restarts, ~125 MB per container |
| Jobs once per interval | observation running; see the report |

**Rehearsal on `siffty`:**
- The first run failed because the `migrate` job had been created as an external-image job. It was recreated (jobs take their git source under `deployment.vcs`).
- The second run failed in `migrate`: Prisma rejects the HA addon's `POSTGRES_URI` ("invalid port number"). Fix: `src/lib/dbUrl.js` builds a single-host URL from the linked parts (`DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`, now linked in `prod-secrets`).
- The rehearsal continues once the Gate 3 batch is pushed.
- The `release` workflow was switched back to `master` with its push trigger after the attempts (verified 2026-09-26). The next rehearsal switches it temporarily again and restores it.

## Gate 3b rehearsal (2026-09-26, project `siffty`, no domains, empty database)

| Check | Result |
|---|---|
| Release workflow end to end from `scale-prod` | ✅ migrate build → migrate on the empty DB (HA URL fix works) → api + web builds; trigger restored to `master` and verified |
| Deploy of a non-tracked-branch build | needs `update service deployment {"internal":{"buildSHA":…}}` (CD only follows the tracked branch) |
| `/livez`, `/health` on `http--api--ggvsbt6z8cd4.code.run` | ✅ 200 / 200 |
| Boot log | redis adapter, bullmq, AI mock off, dry-run email, scheduler off, **Cashfree mode: sandbox** (owner to set `CASHFREE_ENV=production`) |
| Config check (in the container, statuses only) | all required set; FAIL only on `EMAIL_DRY_RUN=true` (expected until cutover) and **`CASHFREE_ENV` sandbox vs production key** |
| Postgres | 18.4; `max_connections` **750** (3 reserved); connected to the **primary endpoint**, single host, not a replica |
| Failover (addon restart) | Postgres restarted at 05:08:58 UTC; connections terminated; **API reconnected by itself; `/health` failed for ~1 s** (1 of 271 samples) |
| Redis | `rediss://`, `REDIS_TLS_INSECURE=false`, connected. **Strict TLS works** |
| `TRUST_PROXY` | default (1) gives `req.ip` = the owner's public IP. **Keep unset** (DNS records must stay DNS-only) |
| k6 spike (spec shape, 2 instances) | 0.00 % errors, **p95 54.5 ms** (34,614 req); no-think-time variant 0.00 %, p95 134.7 ms at 957 req/s; CPU peaked 60 %, so no scale-up |
| Autoscaling proof (up to 300 VUs, sustained) | 0.00 % errors, p95 209 ms at 1,703 req/s; CPU 75–78 % → **3rd instance at 11:03:55 IST, back to 2 at 11:08:57** |
| `web` boot | `/` 200 in 0.27 s, `/privacy` 200, `next/image` optimizer 200 |
| Cashfree | no calls made (scheduler off, no order endpoints hit) |
| After | `api` and `web` at 0 instances, autoscaling off |

Pool: with `DB_POOL_SIZE=8` the worst case is 6 × (8 + 2 + 1 + 2) + 2 + 5 = **85 of 747** usable (89 % headroom).

## Gate 3c (2026-09-26)

- **Instagram connect on the local stack:**
  - Meta rejected the code exchange with "redirect_uri is not identical".
  - Cause: the local compose file overrode `INSTAGRAM_APP_SECRET` with a throwaway value for the webhook burst test. The code exchange is signed with that secret, and Meta reports a wrong secret with this misleading message.
  - Fixed locally: the override moved to `deploy/local/docker-compose.burst.yml` (burst tests only).
  - `scale-prod`'s OAuth path is unchanged. The failed attempts reached the code exchange, which proves state and cookie worked across both instances.
  - Proof: the owner reconnects on the local stack (pending).
- **USD:**
  - Checkout now enforces `USD_PRICING_ENABLED`: a 409 `INTL_PRICING_DISABLED` response.
  - A Cashfree connector probe (`sfy_gate3c_usd_probe_001`, $49, PayPal) was refused with "order Currency not enabled for this merchant account". The connector doesn't expose whether it's sandbox or production, so **USD enablement on the live account is unconfirmed** (runbook P8).
- **Email quota:** alerts at 80 % of the cap and on any blocked critical email.
- **Config check in production:**
  - `CASHFREE_ENV`, `BILLING_ENABLED` and `USD_PRICING_ENABLED` match; `DB_POOL_SIZE=8`.
  - `META_APPROVED` is still unset.
  - The public web bundle bakes `NEXT_PUBLIC_CASHFREE_MODE=production` and `api.siffty.com`.
- **Delhi unit prices** (from Northflank usage) equal the list prices: $0.01667/vCPU-h, $0.00833/GiB-h, $0.15/GB-mo.

## Open items

1. F2 and F3 are implemented (Gate 3 batch). See `docs/ISOLATION_AUDIT.md`.
2. Real `max_connections`, Redis TLS verification, and autoscaling behaviour are checked in the Gate 3 prod smoke test.
3. The old server stored only hashes, so deliveries it acknowledged but didn't finish can't be recovered after cutover. Zero loss at cutover depends on Meta retrying deliveries while the old API is at 0 instances (they get connection errors, not 200s).

## Cutover — Phase P (2026-09-26)

- Gate 3c batch pushed (`e5694c1..4ee580c`).
- **P1 config check:** first run PASS except `EMAIL_DRY_RUN=true` (expected). `USD_PRICING_ENABLED` was `true`.
- **P2 USD live check:** `api.cashfree.com` refused the $1 USD order `sfy_cutover_usd_probe_1790404851446`: `400 order_create_failed, "order Currency not enabled for this merchant account"`. Nothing was created. Owner set `USD_PRICING_ENABLED=false`: **INR-only launch**.
- **P1 re-run:** matches `USD_PRICING_ENABLED=false`, `COOKIE_SAMESITE=lax`, and the rest. Only `EMAIL_DRY_RUN=true` flagged.
  - A running service does **not** restart when a secret-group value changes. `api` had to be restarted to see the new value. In the window, the flags flip while `api` is at 0, so the fresh start picks them up.
- **P3 old references:**
  - Northflank: `api.siffty.com` → `codeback-backend`, `app.siffty.com` → `codeback-frontend` (moved in the window).
  - Old default URLs `site--codeback-{backend,frontend}--84qlkxm9y5r8.code.run`: no reference in the repo.
  - DNS: `api`/`app` CNAME → `<fqdn>.muba-8sb4.dns.northflank.app` (team-level, Northflank re-points it; TTL 60 s), DNS-only. `siffty.com`/`www` → Cloudflare 302 to `app.siffty.com`.
  - Code-derived callbacks are all on `api.siffty.com`: Instagram `REDIRECT_URI` (config-check rule), Google `BACKEND_URL/auth/google/callback`, Cashfree `notify_url`.
  - The Meta webhook, deauthorize, data-deletion and Google Console entries can't be read with the available credentials → owner checks them.
