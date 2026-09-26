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
- **P4:** old `codeback-backend`/`codeback-frontend` `disabledCI: true`, `disabledCD: true` (from `list services`; `get service` doesn't return `disabledCD`).
- **P5:** `release` trigger removed (paused) 07:02 UTC; the steps still build `master`.
- **CI:** the first PR run failed to load `tests/pro-upgrade-verdict.test.js` (it imports a frontend file that needs `react`; the backend job didn't install the frontend packages). Fixed in `39646f9`. Re-run: all 3 checks green.
- **P6:** owner merged PR #3 at 08:36:51 UTC → **merge SHA `c0f907561fc39b95c6b26b2c7fc8b3ba903e601b`**. Afterwards, the old project's latest builds were still `5fad3e0` (2026-09-25, running), and `siffty` had no workflow run and no build.
- **P7 pre-build from `c0f9075`, all SUCCESS:**
  - `migrate` build `mutual-scarf-1648`; the job runs the latest `master` build;
  - `api` build `talented-wax-8142` (image tag `…:6ab78510a4bd1af528c4977d`);
  - `web` build `snazzy-scale-9712` (image tag `…:6ab785189a7083d5a271eb7c`).
  - `api`/`web` deployments set to `c0f9075` (`update service deployment {"internal":{"buildSHA":…}}`); instances 0.
  - `api`/`web` had `disabledCD: true`: the rehearsal deploys of pinned builds turned CD off. To re-enable at W8 with the trigger.
- **P10 on the pre-built images (1 instance each, then back to 0):**
  - built-in `configCheck --expect`: everything matches, only `EMAIL_DRY_RUN=true` flagged;
  - boot: Cashfree production, Redis adapter, BullMQ, AI mock off, scheduler off, email dry-run;
  - web bundle: `NEXT_PUBLIC_CASHFREE_MODE` baked `"production"`, `api.siffty.com`, no `code.run`;
  - Redis queues empty; scheduler run marks live in the database (`job_runs`), so the import carries them over.
- **Import method:** the CLI import needs a `.gz` URL or a live connection string. The window import is the owner's UI upload. Northflank: "All existing user databases will be removed … All databases from the backup source will be imported"; how a plain single-database dump is handled is **not rehearsed**. A dev-data dump for a rehearsal is at `C:/siffty-backup/rehearsal-dev.sql`.
- **Import rehearsal (dev data, 2026-09-26):**
  - Dump: the local dev DB (`siffty-dev-pg18/codeback`, 44 tables) with the window flags (`pg_dump 18 --format=plain --no-owner --no-acl --no-comments`) → `C:/siffty-backup/rehearsal-dev.sql`, 4.6 MB.
  - Owner UI: `siffty/postgres` → Backups → Import (file upload) → backup `rehearsal-dev-sql` completed in **10 s** → Restore (`dump-restore`) 09:01:44 → 09:03:00, **76 s**.
  - A plain single-database dump **lands in the addon's default database, the one the app uses**: `migrate` found all 32 migrations applied ("No pending migrations to apply", 37 s).
  - Row counts (`rowCounts.js` on `api`): 44/44 tables equal the dump. `job_runs` 969 = dev rows started before the dump (08:54:19Z); the local stack kept writing afterwards.
  - Token self-check not run (dev tokens use the dev key).
  - `api` back to 0.
  - **Temporary:** backup entry `rehearsal-dev-sql` in `siffty/postgres` (delete with approval in Gate 4) and the local file `C:/siffty-backup/rehearsal-dev.sql`.
  - The new DB now holds dev data until the window import replaces it.

## Cutover window #1 — rolled back (2026-09-26)

| Time (UTC) | Event |
|---|---|
| 09:18:22 | owner "go" |
| **09:18:58** | **T0**: old `codeback-backend` scaled to 0; `api.siffty.com/health` 503 |
| ~09:22 | `northflank forward` needs an admin shell on Windows. Docker resolves the forwarded hostname to `127.24.1.1` (the container's own loopback) → refused. Fix: a local relay `127.0.0.1:55999 → 127.24.1.1:5432`, containers use `host.docker.internal:55999` |
| 09:28 | dump `final-cutover.sql` (551 KB, complete); old counts: **45 tables, 2,703 rows**, `_prisma_migrations` 29 (`C:/siffty-backup/old-counts.txt`) |
| 09:30:28–09:31:14 | restore **failed**: the dump contains Northflank's `CREATE SCHEMA pooler` (+ `pooler.user_lookup`) and `pg_stat_statements`/`pg_stat_kcache`; the new DB already has `pooler` → "schema pooler already exists", psql exit 3 (before any table) |
| 09:40:50–09:41:40 | re-dump with `--exclude-schema=pooler --exclude-extension=pg_stat_statements --exclude-extension=pg_stat_kcache` (`final-cutover-v2.sql`, 550 KB); restore completed |
| 09:42:29–09:42:48 | **migrate FAILED**: `20260928090000_trial_warning_sent_marker` → `ERROR 42501: must be owner of table entitlements`. Northflank's restore runs psql as its own internal user, so every restored object is owned by that user, not the app user (`DB_USER`). DML works, DDL doesn't → no migration can ever run. The dev rehearsal missed it (no pending migration) |
| ~09:44 | owner rolled back: `codeback-backend` → 1 (still `5fad3e0`, CI/CD off) |
| **09:46:29** | `api.siffty.com/health` 200 again. **Downtime 27 min 31 s** |

State after the rollback:
- The old stack is serving.
- New `api`/`web` at 0, release trigger still paused, CD off.
- The new DB holds the 09:18 production copy with objects owned by the restore user and a failed migration record. It will be recreated.
- `C:/siffty-backup/final-cutover.sql` (full) and `final-cutover-v2.sql` are kept.

Lessons:
1. A Northflank UI restore is fine for *data*, but the objects end up owned by Northflank's restore user → load the dump **as the app user** instead.
2. Plain dumps of a Northflank database include the `pooler` schema and monitoring extensions → exclude them.
3. The rehearsal must include a pending migration.

## Rehearsal #2 — load as the app user, REAL data (2026-09-26, agent-run, old site online)

Credential exception (owner, 2026-09-26): the agent may load `siffty/postgres` app + admin logins (and `codeback-postgres` for the window dump only) into env vars inside one command. Values are never printed or written. The helper `scratchpad/pgrun.sh` passes them to `docker run -e NAME`.

| Step | Result | Time |
|---|---|---|
| Flags (one-off `migrate` job run with an injected `configCheck`) | `EMAIL_DRY_RUN=true`, `RUN_IN_PROCESS_SCHEDULER=false` | — |
| Old site | `/health` 200; DMs processed 09:52, 10:02, 10:04 UTC after the rollback | — |
| Forward without admin rights | `northflank forward addon … --skipHostnames` → `127.24.1.1` (primary, `pg_is_in_recovery()=f`); relay `127.0.0.1:55998` | — |
| Admin inspection | the restore runs as **ADMIN**: all 45 restored tables were admin-owned; admin owns the DB and `public`, is a member of the app role, not superuser | — |
| Empty (admin, siffty DB only) | dropped the app tables/types/functions in `public` only (extension objects, `pooler` and schema ACLs kept) → 0 app objects left | ~10 s |
| Precheck (app user) | PG 18; **CAN create in `public`** (grant, not DB owner); create-table probe OK; no extension needed (dump has no `CREATE EXTENSION`; migrations only use the built-in `gen_random_uuid()`) | ~5 s |
| **Load `final-cutover-v2.sql` as the app user** | `psql -v ON_ERROR_STOP=1`: exit 0, no errors | **23.6 s** |
| **migrate** | **exactly 3 applied** (`…trial_warning_sent_marker`, `…webhook_delivery_inbox`, `…message_id_unique_per_conversation`) | **49 s** wall (6 s in the container) |
| Postcheck | app objects all owned by the app user: 45 tables, 137 indexes, 11 enums (the 46 functions/4 views are `pg_stat_*` extension objects); 32 migrations, 0 failed | — |
| Row counts | 45/45 tables equal `old-counts.txt`; `_prisma_migrations` 29 → 32 | — |
| Self-check (`api` at 1, flags safe) | tokens **3/3 (100 %)**, identities **3/3 (100 %)** → PASS | api ready in 22 s |
| Cleanup | `api` → 0; app objects emptied again; forward + relay stopped | — |

State after the rehearsal: new DB empty (app objects), `api`/`web` 0 on `c0f9075`, CD off, release trigger paused, old site 200.

Window #2 method changes:
- The flags go on the **`api` service itself** (Northflank: service variables always override secret groups). `api`'s own variables are only `PORT=5000`, so the update sets `{PORT:5000, EMAIL_DRY_RUN:false, RUN_IN_PROCESS_SCHEDULER:true}`. `prod-secrets` is not read or changed.
- **Domains:** each subdomain has one path `/`. Move = `assign subdomain path` (path `<fqdn>`) to `siffty/api:http` / `siffty/web:http`. Rollback = the same to `codeback-backend:site` / `codeback-frontend:site`. DNS CNAME is team-level (`*.muba-8sb4.dns.northflank.app`, TTL 60 s), so there's no Cloudflare change.

## Cutover window #2 — SUCCESS (2026-09-26, agent-run)

| Time (UTC) | Step |
|---|---|
| 10:22–10:24 | pre-window: old site 200; new `api`/`web` 0 on `c0f9075`; trigger paused. Forwards without admin rights: new DB `127.24.1.1` (relay :55998), old DB `127.24.1.3` (relay :55999). Old DB PG 18.4 (45 tables); new DB empty. Watcher on both domains |
| 10:24:56 | W1 `codeback-backend` → 0 |
| **10:25:02** | **T0**: `api.siffty.com/health` 503 |
| 10:25:05–10:26:00 | W2 dump as the old app user, exclusions `pooler`/`pg_stat_statements`/`pg_stat_kcache` → `C:/siffty-backup/final-cutover-w2.sql` (575 KB, complete, 0 schema/extension DDL, 45 COPY). Old counts `old-counts-w2.txt`: **45 tables, 2,799 rows**, `_prisma_migrations` 29. 55.7 s incl. counts (cross-region) |
| 10:26:19–10:26:48 | W3 load as the new app user, `ON_ERROR_STOP`: exit 0, 29.0 s |
| 10:26:58–10:27:26 | W4 migrate: **exactly 3 applied**, 28.6 s |
| 10:27:40 | W5 `api` service-level env = `PORT`, `EMAIL_DRY_RUN=false`, `RUN_IN_PROCESS_SCHEDULER=true` (overrides the group; `prod-secrets` untouched) |
| 10:28:26–10:28:51 | W6 autoscaling on (`api` 2–6, `web` 1–3, CPU 70 %/mem 80 %); `api` 2 running, `web` 1; `*.code.run` health 200 |
| 10:29:23 | W7 `configCheck --expect` (12 expectations incl. live flags): **PASS, zero exceptions**. Self-check tokens **3/3**, identities **3/3** (100 %). Counts: 45/45 tables; equal except `_prisma_migrations` +3 and new live writes (`ai_analyses` +3, `ai_call_logs` +3, `job_runs` +3) |
| 10:29:51 | W8 `assign subdomain path --subdomainPath <fqdn>` → 404 (the path id is `/`, not its name); retried with `--subdomainPath /` → OK at 10:31:00 |
| **10:31:12** | **T1**: `api.siffty.com/health` 200 from the new LB `34.126.218.73` (Delhi); `app` at 10:31:45. DNS-only (CNAME → Northflank team DNS → LB); TLS Let's Encrypt, SAN matches, expires 2026-12-02 |
| 10:33:13 | W9 release trigger restored (`vcs-push` `master`) |
| 10:33:37–10:35:26 | CD on: `patch {"disabledCD":false}` had no effect; `update service deployment {"internal":{"id":…,"branch":"master","buildSHA":"latest"}}` enables CD (rolling redeploy of the same `c0f9075`). `web` then `api`: **0 non-200 health samples** during the rollout |

**Downtime (API): 10:25:02 → 10:31:12 = 6 min 10 s.** The web app never went down (the old frontend served until 10:31:45).

### After window #2 — verification (10:36–10:45 UTC)

- A new real DM was delivered at 10:36:29, processed and analysed (webhook backlog 0, no errors). **No DM sent during T0–T1 has been retried by Meta yet**; re-checked at the end of the 2-hour watch.
- Scheduled jobs run once each across 2 instances, no failures: `admin_alerts`, `stalled_analysis_sweep`, `webhook_recovery` (the longer-interval jobs run when due; their `job_runs` history came across).
- Boot on every container: Cashfree production, email transport Resend, scheduler ON, Socket.io Redis adapter.
- **Cashfree live:** ₹1 INR order `sfy_cutover_inr_probe_1790419101509` CREATED on `api.cashfree.com`, then TERMINATION_REQUESTED (no payment).
- **Logins:**
  - Google OAuth start → `accounts.google.com` with `redirect_uri=https://api.siffty.com/auth/google/callback`;
  - email login for an unknown user → 401 "not right";
  - `app` pages 200; Socket.io handshake 200.
- **Pre-existing, not migration-related:** Gemini `402 RESOURCE_EXHAUSTED` since 09:11 UTC (31 calls on the old stack, 6 on the new). AI analysis uses the fallback. `prisma:error` "Unique constraint (tenant_id, message_id, type)" = the `credit_ledger` idempotency guard when the sweeper retries those analyses (no double charge).
