# Scale-up log — `scale-prod`

Source of truth for the in-place scale-up of Siffty on Northflank. **Read this first in a new session.**
No secrets in this file: names only.

## Plan in one paragraph

Scale the existing Northflank project `codeback` (region `us-central`, managed cloud, pay-as-you-go) in place.
There is no new cluster, no data migration and no DNS move for `app`/`api`. The API goes to 2 instances (autoscaling to 4).
A Redis addon backs the job queue (BullMQ), the Socket.io adapter, the rate limits and the email quota. Sessions stay in Postgres.
Scheduled jobs run in-process on every instance but execute once per interval (due-check + `pg_try_advisory_lock`).
Staging runs in the same project as `stg-*` resources on `new-app` / `new-api.siffty.com` until Gate 4.

History: GCP-direct (Gate 1) and Northflank BYOC on GKE (Gate 1b) were both evaluated and cancelled.
BYOC's 8-vCPU minimum put it at about $330/month.

## Gate status

| Gate | State |
|---|---|
| 1 — audit | done (2026-09-25) |
| 1b — BYOC re-plan | done, BYOC cancelled |
| 2 — code + temporary staging | **report delivered; waiting for commit approval** |
| 3 — verify on staging | — |
| 4 — production rollout | — |

## Facts established

- The prod Postgres addon `codeback-postgres` runs **v18** (not 16 as README said), on nf-compute-20 with 6 GB nvme and TLS.
  Its backups are a weekly snapshot kept 120 days. Local dev and tests use v16. CI uses v18.
- Services `codeback-backend` (port 5000) and `codeback-frontend` (port 3000) build with **Heroku-24 buildpacks** from `master` of `dev-mubassir/codebackV2`.
  That is the same repo as the local `origin` (the GitHub account was renamed and old URLs redirect).
  They run on nf-compute-20, 1 instance each, with build plan nf-compute-400-16.
- Northflank team plan: pay-as-you-go. Sandbox would not have allowed the extra addons.
- Northflank Redis: AOF always on, minimum disk 4 GB, `maxmemory-policy` fixed at creation (we use `noeviction`).
- Northflank Postgres restore/import **replaces every database in the addon**. Only ever import into a staging addon.

## Resources

### Permanent (Gate 4 creates or changes them)
| Resource | Size | Notes |
|---|---|---|
| `codeback-backend` | nf-compute-50 × 2, autoscale ≤ 4 at 70% CPU | switch to Dockerfile build (`/backend/Dockerfile`) |
| `codeback-frontend` | nf-compute-20 × 1, max 2 | switch to Dockerfile build (`/frontend/Dockerfile`) |
| `codeback-postgres` | upgrade nf-compute-20 → nf-compute-50 | daily backup kept 7 days |
| Redis addon (prod) | nf-compute-50, 4 GB, `noeviction` | linked to the backend via addon link → `REDIS_URL` |
| `siffty-migrate` job | nf-compute-20 | `npx prisma migrate deploy`, run by the release flow before deploy |

### Temporary (delete in Gate 4)
| Resource | Created | Size |
|---|---|---|
| addon `stg-postgres` | 2026-09-25 | PG 18, nf-compute-20, 6 GB nvme, TLS |
| addon `stg-redis` | 2026-09-25 | Redis latest, nf-compute-20, 4 GB, TLS, `noeviction` |
| secret group `stg-secrets` | 2026-09-25 | restricted to tag `stg`; links `stg-postgres` → `DATABASE_URL` and `stg-redis` → `REDIS_URL` |
| tag `stg` | 2026-09-25 | team-level resource tag |
| subdomain `new-api.siffty.com` | 2026-09-25 | CNAME `new-api.siffty.com.muba-8sb4.dns.northflank.app` |
| subdomain `new-app.siffty.com` | 2026-09-25 | CNAME `new-app.siffty.com.muba-8sb4.dns.northflank.app` |
| services `stg-api`, `stg-web`, job `stg-migrate` | Gate 3 (specs in `deploy/northflank/`) | need `scale-prod` on GitHub first |
| local Docker `siffty-test-redis` | 2026-09-25 | redis:7-alpine on :56379, for the test suite (not cloud) |
| local Docker `siffty-test-pg18` (stopped) | 2026-09-25 | postgres:18-alpine on :55433 — one suite run against PG 18 (not cloud) |
| local DB `siffty_smoke` in `codeback-pg` | 2026-09-25 | smoke-boot target for the API image (not cloud) |
| local image `siffty-api-test` | 2026-09-25 | locally built API image, 783 MB (not cloud) |

## Connection budget (Postgres)

Per API instance: Prisma 5 + user-session pool 3 + admin-session pool 2 + scheduler lock pool 2 = **12**.
These caps are enforced in code (`lib/prisma.js`, `src/index.js`, `lib/adminSession.js`, `jobs/scheduler.js`).
`DB_POOL_SIZE` lowers the Prisma share without a code change.

| | connections |
|---|---|
| 4 API instances × 12 | 48 |
| `siffty-migrate` | 2 |
| ad-hoc (psql, admin scripts) | 5 |
| **worst case** | **55** |
| Postgres `max_connections` (default 100, 3 reserved) | 97 usable → **43% headroom** |

**Open:** Northflank's actual `max_connections` for nf-compute-50 isn't confirmed yet. The admin health page now shows `active / max`; read it on staging in Gate 3.
If max is under 79 (the point where 55 connections leaves 30% headroom), set `DB_POOL_SIZE=3`, which makes the worst case 47.

## Cost (Northflank, pay-as-you-go list prices)

| Item | $/mo |
|---|---|
| API nf-compute-50 × 2 | 24.00 |
| Web nf-compute-20 × 1 | 5.40 |
| Postgres nf-compute-50 + 6 GB | 12.90 |
| Redis nf-compute-50 + 4 GB | 12.60 |
| Migrate job, builds, backups, egress (buffer) | 5.00 |
| **Normal load** | **≈ 59.90** |
| Peak: API at 4 instances | +24.00 if sustained all month (pro-rated per second) |
| Peak: web at 2 instances | +5.40 if sustained |
| **Absolute ceiling (everything at max, all month)** | **≈ 89.30** |

Temporary staging costs about $41/mo while it exists (about $1.40/day).

## Decisions (approved)

- D1: sessions stay in Postgres. The broken Redis session branch was deleted.
- D3: BullMQ on Redis with `noeviction`.
- D4: one additive migration, `20260928090000_trial_warning_sent_marker` (a nullable column).
- New flags: `EMAIL_DRY_RUN` and `RUN_IN_PROCESS_SCHEDULER`. The console email transport refuses to start in production.
- Cashfree webhook: process first, then 200. The ±5 min timestamp window is log-only (`WEBHOOK_TIMESTAMP_ENFORCE` defaults to off).
- D9: PRO = ₹1,299. The drift came from a test fixture (`refunds-and-revocation.test.js`) overwriting the seeded price. The fixture now uses the seed.
- D7: no GitHub Pro. `ci.yml` runs on PRs, and `.githooks/pre-push` blocks pushes to master.

## Open issues / to verify in Gate 3

1. Northflank Postgres `max_connections` (see above).
2. The `trust proxy` hop count behind Northflank's ingress: compare `req.ip` with the real client IP. `TRUST_PROXY` adjusts it.
3. Northflank Redis TLS: whether the certificate verifies. If not, set `REDIS_TLS_INSECURE=true` (internal network only).
4. Whether a Northflank addon plan change (Postgres nf-compute-20 → 50) keeps data and version. Test on `stg-postgres` first.
5. What timestamp Cashfree sends on webhook retries (sandbox). That decides whether `WEBHOOK_TIMESTAMP_ENFORCE` gets turned on.
6. `/_next/image` works in the standalone image (sharp install scripts aren't in the frontend's allowScripts).
