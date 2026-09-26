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
| 3 — F2/F3, self-check, dev-machine tests, rehearsal, runbook | **report delivered; F2/F3 batch waiting for approval; rehearsal blocked on it** |
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

## Open items

1. F2 and F3 are implemented (Gate 3 batch). See `docs/ISOLATION_AUDIT.md`.
2. Real `max_connections`, Redis TLS verification, and autoscaling behaviour are checked in the Gate 3 prod smoke test.
3. The old server stored only hashes, so deliveries it acknowledged but didn't finish can't be recovered after cutover. Zero loss at cutover depends on Meta retrying deliveries while the old API is at 0 instances (they get connection errors, not 200s).
