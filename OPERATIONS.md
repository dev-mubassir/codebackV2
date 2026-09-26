# Operations

Day-2 runbook for Siffty on Northflank. Production has run in project **`siffty`** (region `asia-south-delhi`) since the cutover on 2026-09-26. The migration history is in `MIGRATION_LOG.md`.

## Production at a glance

| Piece | What | Notes |
|---|---|---|
| `api` | combined service, Node backend, port `http` (5000) | autoscaling **2–6** (CPU 70 %, memory 80 %). `api.siffty.com` |
| `web` | combined service, Next.js standalone, port `http` (3000) | autoscaling **1–3**. `app.siffty.com` |
| `migrate` | manual job, `Dockerfile.migrate` (`prisma migrate deploy`) | runs the latest `master` build |
| `postgres` | Postgres 18 HA addon (2 replicas) | nightly snapshot 21:30 UTC |
| `redis` | Redis addon (AOF, `noeviction`) | socket adapter, BullMQ, rate limits, email quota |
| `release` workflow | on push to `master`: build + run `migrate`, then build `api` and `web` | CD deploys each new `master` build |
| Domains | `api`/`app` → one path `/` each → `siffty/api:http`, `siffty/web:http` | Cloudflare **DNS-only** (grey cloud); the CNAME targets are Northflank team DNS names, so moving a domain needs no DNS change |

### Live flags are set on the `api` SERVICE, not in `prod-secrets`

`EMAIL_DRY_RUN=false` and `RUN_IN_PROCESS_SCHEDULER=true` are **service-level variables on `api`**, next to `PORT=5000`. Northflank: "variables set directly in a service … will always override variables with the same name inherited from secret groups."

`prod-secrets` still holds the rehearsal values (`true` / `false`). **Never delete the service-level variables.** Without them, `api` goes back to sending no email and running no scheduled jobs. Optional clean-up: set the same two values in `prod-secrets` too, so both places agree.

## Deploy and roll back

- **Deploy:** merge a PR into `master`. The `release` workflow builds and runs `migrate`, then builds `api` and `web`; CD deploys them (rolling, no downtime).
- **Roll back code:** Northflank → `api` (or `web`) → Deployments → redeploy the previous build.
  - A redeploy pins that build and turns CD off. To turn CD back on:
    ```bash
    northflank update service deployment --projectId siffty --serviceId api -i '{"internal":{"id":"api","branch":"master","buildSHA":"latest"}}'
    ```
    (`patch service {"disabledCD": false}` has no effect.)
- **Roll back data:** restore from a backup (below). The old `codeback` project is being retired, so there is no infrastructure to roll back to.

## Backups

- **Northflank:** `siffty` → `postgres` → Backups. Nightly snapshot at 21:30 UTC, plus on-demand backups.
- **Owner's laptop, `C:/siffty-backup/`:**
  - `final-cutover.sql`: the full old-database dump from window #1, including Northflank internals;
  - `final-cutover-w2.sql`: the dump actually loaded at the cutover;
  - `old-counts*.txt`: row counts.
  - Keep them **at least 30 days**.
- **Restore drill:** `CUTOVER_RUNBOOK.md` §10.

## Database maintenance (read this before any restore or import)

- **Never load a dump through the Northflank UI's Import → Restore.** The restore runs as the addon's ADMIN user, so every object ends up admin-owned. The app user can then read and write rows, but no migration can alter a table (`42501 must be owner of table …`). That is what failed in cutover window #1.
- **Load dumps as the app user** instead:
  - `northflank forward addon --projectId siffty --addonId postgres --skipHostnames` (needs no admin rights on Windows), plus a local relay so Docker can reach it through `host.docker.internal`;
  - then `psql -v ON_ERROR_STOP=1 -f dump.sql` with the app user's login.
- **Dumps of a Northflank database** need `--exclude-schema=pooler --exclude-extension=pg_stat_statements --exclude-extension=pg_stat_kcache`. Those are Northflank's own objects, and they already exist in the target.
- **If a UI restore is ever used anyway,** fix ownership as admin, `public` schema only, with `ALTER TABLE/TYPE … OWNER TO <app user>`. Don't use `REASSIGN OWNED BY`: it would also hand over the database and Northflank's `pooler` schema.
- **Checks:** `deploy/cutover/precheck.sql` (can the app user create in `public`?), `postcheck.sql` (ownership + migrations), `row-counts.sql`.

## Known issues (2026-09-26)

- **Gemini returns `402 RESOURCE_EXHAUSTED`** since 09:11 UTC (it started on the old stack). AI analysis falls back to a basic result until the Gemini quota or billing is topped up in Google AI Studio.

## Git workflow: master only changes through a merged PR

`master` deploys to production. The repo is private on GitHub Free, so GitHub branch protection isn't available. Two things stand in for it.

### 1. Local pre-push hook (blocks direct pushes to master)

Activate once per clone:

```bash
git config core.hooksPath .githooks
```

`.githooks/pre-push` refuses any push whose target is `refs/heads/master`. Work on a branch, push the branch, and open a PR.

`git push --no-verify` bypasses any hook, so this is a guard rail against accidents, not a lock.

### 2. CI on every pull request (`.github/workflows/ci.yml`)

- **Backend tests:** the full vitest suite against Postgres 18 and Redis 7 service containers.
- **Frontend lint + build:** `npm run lint` and `npm run build` with public build args.
- **Docker images build:** both Dockerfiles build.

Merge only when all three are green. A red run means don't merge.

### Running the backend tests locally

They need a throwaway Postgres and a Redis:

```bash
docker run -d --name siffty-test-redis -p 56379:6379 redis:7-alpine
```

Postgres is the `codeback-pg` container on port 55432 (database `codeback_test`, recreated on every run). Override with `TEST_DATABASE_URL` and `TEST_REDIS_URL`.

## Secrets: a change needs a restart

Changing a value in a secret group (`prod-secrets`, `web-build-args`) does **not** restart running services. They keep the old value until they restart. Seen on 2026-09-26: `api` still read `USD_PRICING_ENABLED=true` after the group had been changed to `false`.

After every secret change:
- **`prod-secrets` (runtime):** restart `api`: Northflank → `api` → Restart, or `northflank restart service --projectId siffty --serviceId api`. The `migrate` job reads the group on its next run.
- **`web-build-args` (build time):** `NEXT_PUBLIC_*` values are baked into the bundle, so a restart isn't enough. **Rebuild and deploy `web`.**
- Confirm with the config check, names and statuses only, e.g. `node src/cli/configCheck.js --expect BILLING_ENABLED=true`.
