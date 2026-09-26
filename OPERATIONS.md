# Operations

Day-2 runbook for Siffty on Northflank (project `codeback`). The deploy, rollback, logs, scaling, alerts and backup-restore sections are written in Gate 4 of the scale-up. See `MIGRATION_LOG.md` for its state.

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
