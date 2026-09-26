# Cutover runbook — `codeback` (us-central) → `siffty` (asia-south-delhi)

**Start only when the owner says "start cutover".** The owner is present throughout.
Owners: 🧑 = you, 🤖 = agent. Target maintenance window (steps 2–6): **under 15 minutes**. See "Timing" at the end.

**Never:**
- run an addon import on the OLD `codeback-postgres`;
- push `master` from a terminal (it only changes by merging the PR);
- read or paste any secret value.

## Preconditions (checked before the window, 🤖 reports each)

| # | Check | How | Pass |
|---|---|---|---|
| P1 | The Gate 3b rehearsal passed (2026-09-26): release end to end from `scale-prod`; HA URL on the primary endpoint; failover ≈ 1 s; Redis TLS strict; `max_connections` 750; `TRUST_PROXY` default verified; autoscaling 2→3→2 | MIGRATION_LOG.md | ✅ done |
| P2 | `release` workflow: steps build `master`; trigger = push to `master` (step 1 pauses it) | `northflank get workflow --projectId siffty --workflowId release` | yes |
| P3 | `prod-secrets` holds every required key (names only). The two cutover flags are still at rehearsal values: `EMAIL_DRY_RUN=true`, `RUN_IN_PROCESS_SCHEDULER=false` | 🤖 config check, names only | yes |
| P4 | New `api` and `web` at 0 instances, no custom domains | `northflank get service …` | yes |
| P5 | Meta "Server IP allowlist" is empty | 🧑 Meta app → Settings → Advanced | confirmed |
| P6 | Local backup of old prod is fresh (last 24 h) | 🧑 | yes |

## 1. Day before — 🧑 + 🤖, ~15 min (outside the window)

1. 🧑 **Turn OFF auto-deploy (CI and CD) on BOTH old services, `codeback-backend` and `codeback-frontend`.**
   - Check 🤖: `northflank get service --projectId codeback --serviceId codeback-backend` (and frontend) → `disabledCI: true`, `disabledCD: true`.
   - **Do not continue until 🤖 confirms both.**
2. 🤖 **Pause the new release trigger:** update workflow `release` with `triggers: []` (steps still build `master`).
   - Check: `northflank get workflow … release` shows no triggers.
3. 🧑 **Merge the PR `scale-prod` → `master`** (CI green).
   - Nothing deploys anywhere: the old project's auto-deploy is off and the new trigger is paused.
   - Check 🤖: no new build on `codeback-*`; no workflow run on `siffty`.
4. 🤖 **Pre-build from the merged `master` commit** (record the SHA):
   - `northflank start job build --jobId migrate` with that SHA
   - `northflank start service build --serviceId api` with that SHA
   - `northflank start service build --serviceId web` with that SHA

   All three must succeed. `api`/`web` have CD on and track `master`, so each build becomes that service's deployment while the service is at **0 instances** (nothing runs). `migrate`'s build becomes the job's deployment.
   - Check: `northflank get service --serviceId api` shows the merge SHA as the deployed build. If CD didn't pick it up, deploy it explicitly (combined services accept only the SHA):
     ```bash
     northflank update service deployment --projectId siffty --serviceId api -i '{"internal":{"buildSHA":"<MERGE_SHA>"}}'
     ```
     Do the same for `web`.
5. 🧑 `prod-secrets`: confirm `CASHFREE_ENV=production`, `EMAIL_DRY_RUN=true`, `RUN_IN_PROCESS_SCHEDULER=false` (the last two flip in step 4). `web-build-args`: `NEXT_PUBLIC_CASHFREE_MODE=production` **before** the pre-build.
6. 🤖 Config check on the pre-built image: start `api` at 1 instance for a minute, run `node src/cli/configCheck.js` → **PASS** (only `EMAIL_DRY_RUN` is expected to read "true in production"), then scale back to 0.

## 2. Maintenance starts — 🧑, 1 min

- **Scale old `codeback-backend` to 0.**
  - Meta's webhooks to `api.siffty.com` now fail (never a 200), so Meta retries them later. Those retries reach the new API after step 6.
- Check 🤖: `https://api.siffty.com/health` no longer answers 200. Record **T0** (the start of the Gate 5 backfill window).

## 3. Final data copy — 🧑 + 🤖, ~4 min

1. 🧑 `northflank forward addon --projectId codeback --addonId codeback-postgres`, then dump with the **v18** client. Use `host.docker.internal` as the host in the URL.
   ```bash
   MSYS_NO_PATHCONV=1 docker run --rm -v C:/siffty-backup:/out postgres:18-alpine pg_dump --format=plain --no-owner --no-acl --no-comments -f /out/siffty-final.sql "<OLD_DB_URL>"
   ```
2. 🧑 Row counts on the OLD database (keep the output):
   ```bash
   MSYS_NO_PATHCONV=1 docker run --rm -v C:/codeback/deploy/cutover:/c postgres:18-alpine psql "<OLD_DB_URL>" -f /c/row-counts.sql
   ```
3. 🧑 Northflank → **`siffty`** → addon **`postgres`** → Backups → **Import** `siffty-final.sql` → restore.
   - It replaces the rehearsal schema; the new addon holds nothing else.
   - Check: import COMPLETED.

## 4. Flags, migrate, deploy the pre-built images — 🧑 + 🤖, ~3 min

1. 🧑 `prod-secrets`: **`EMAIL_DRY_RUN=false`** and **`RUN_IN_PROCESS_SCHEDULER=true`**.
2. 🤖 **Run the `migrate` job** (the pre-built image) on the imported database. It applies the Gate 2/2b/3 migrations.
   - Check: the run succeeds, and its log lists the new migrations as applied.
   - **If it fails: STOP → rollback.** Nothing is serving from the new stack yet.
3. 🤖 **Deploy = start the pre-built images:** `api` autoscaling ON (min 2, max 6, CPU 70 %, memory 80 %), `web` autoscaling ON (min 1, max 3).
   - No build happens in the window.

## 5. Verify the new stack + self-check — 🤖, ~2 min

1. (Instances started in step 4.3.)
2. Check: both `api` instances are ready. `/livez` and `/health` answer 200 on the default `*.code.run` URL. Boot logs show `[Socket.io] Adapter: redis`, `[Queue] Driver: bullmq`, `[Cashfree] Mode: sandbox`, `[Email] Transport: resend`, `[AI] Mock: off`, and the scheduler ON.
3. **Secrets self-check** on the imported data:
   ```bash
   northflank exec service api --projectId siffty --cmd 'node src/cli/secretSelfCheck.js'
   ```
   Tokens and identities must both be **100 % → PASS**. Anything else: **STOP and roll back**. The copied `TOKEN_ENCRYPTION_KEY` or `IG_IDENTITY_PEPPER` differs from the old ones.
4. Row counts on the NEW database, compared with step 3.2. Every table must match except `_prisma_migrations` (+3).
   ```bash
   northflank exec service api --projectId siffty --cmd 'node src/cli/rowCounts.js'
   ```

## 6. Move the domains — 🧑 + 🤖, ~2 min

1. 🧑 Northflank: `api.siffty.com` → remove it from `codeback-backend`, then add it to `siffty/api` (port `http`). Same for `app.siffty.com`: `codeback-frontend` → `siffty/web`.
2. 🤖 Checks:
   - `https://api.siffty.com/health` answers 200 with a valid certificate (issuer, expiry, SAN), served by the new project: the response has no `[Server]` banner from the old stack, and the `api` logs show the request.
   - `https://app.siffty.com` answers 200.
   - Maintenance ends. Note T1.

## 7. Verify on the real domains — 🧑 + 🤖, ~10 min (after the window)

| Check | Owner | Pass |
|---|---|---|
| `/health` | 🤖 | 200 |
| Email login; Google login | 🧑 | both land on the dashboard. Existing sessions survive because `SESSION_SECRET` and `user_sessions` came across |
| Real DM → stored, classified, live in the inbox | 🧑 sends, 🤖 checks logs and `webhook_deliveries` | appears live within seconds; `ai_status` completed |
| Meta retries from T0–T1 arrive | 🤖 | `webhook_deliveries` rows with `received_at` after T1 for events sent during the window; backlog 0 |
| A transactional email arrives (e.g. a password reset to your own address) | 🧑 | received |
| Isolation spot-check with 2 accounts | 🧑 + 🤖 | B cannot see A's conversation (404) |
| Admin health: Redis healthy, adapter `redis`, queue `bullmq`, DB connections active/max | 🧑 | green |
| Admin self-check page `/api/admin/self-check` | 🧑 | 100 % / 100 % |
| **Resume the release trigger:** workflow `release` gets back `vcs-push` on `master` | 🤖 | `get workflow` shows the trigger |
| **UptimeRobot**: HTTP(S) monitor on `https://api.siffty.com/health`, every 5 min, alert to your email | 🧑 | UP |
| Northflank notifications: see "Monitoring" below | 🧑 | enabled |

## 8. Rollback — only in the first ~2 hours after T1

The new database gets writes from T1 on; after about 2 hours, rolling back means losing them. Roll back if the self-check fails, `migrate` fails, logins fail, or DMs don't arrive.

1. 🧑 Move `api.siffty.com` and `app.siffty.com` back to `codeback-backend` and `codeback-frontend`.
2. 🧑 Scale `codeback-backend` back to 1. Leave old auto-deploy **OFF**: `master` now holds the new code. Turn it back on only after `master` is reverted.
3. 🤖 Scale new `api` and `web` to 0; turn autoscaling off.
4. Check: `https://api.siffty.com/health` is 200 from the old stack; a test DM arrives.
5. DMs acknowledged by the new stack during T1–rollback exist only in the new database. List them (`webhook_deliveries` after T1) for Gate 5's backfill.

Code-only rollback (any time): Northflank → `api` → Deployments → redeploy the previous build.

## 9. Cashfree live check — right after step 7 (live keys are in from the start)

1. 🧑 Cashfree **production** dashboard:
   - whitelist `https://app.siffty.com`
   - webhook URL **`https://api.siffty.com/webhooks/cashfree`** (the route is mounted at `/webhooks/cashfree`, `src/index.js`)
2. 🧑 A real ₹1–10 purchase on `app.siffty.com`.
   - Check 🤖: the order goes CREATED → PAID once, the credits/plan are granted once (one ledger GRANT), the webhook log shows a verified signature, and the timestamp-window line reads in-window (it's log-only).
3. 🧑 Refund it from the Cashfree dashboard.
   - Check 🤖: the refund webhook is processed, and credits are revoked once.
4. **If anything fails:** turn billing off without a deploy, using Admin → Settings → `enforce_subscriptions` = off (the runtime kill switch; billing routes 404, the site keeps running). Or set `BILLING_ENABLED=false` in `prod-secrets` and restart `api`. Investigate, then turn it back on.

## 10. Day 2 — backup restore drill (🧑 + 🤖)

1. 🧑 Northflank → `siffty` → `postgres` → Backups: download the first nightly backup (the daily snapshot runs 21:30 UTC / 03:00 IST). If snapshots can't be downloaded, take a manual **native (dump)** backup and download that.
2. 🤖 Restore it into a local Postgres 18 (never into `codeback-pg`'s dev database):
   ```bash
   docker run -d --name siffty-restore-drill -e POSTGRES_PASSWORD=postgres -p 55435:5432 postgres:18-alpine
   ```
   Load the downloaded dump into it with `psql` (or `pg_restore` for a custom-format file).
3. Check: `deploy/cutover/row-counts.sql` on the restored copy matches `src/cli/rowCounts.js` on production, taken at about the backup time. Differences are only rows written after the backup.
4. 🤖 Remove the drill container afterwards.

## 11. Later

- 🧑 After 7 stable days, delete the old `codeback` project, after one last local backup.
- **Gate 5 (day 8+, after the old project is deleted):** the Instagram Conversations API backfill, run over [T0 − 5 min, T1 + 30 min] and any rollback window.

## Monitoring

- **Northflank notifications:**
  - Email alerts are a per-user setting: 🧑 Account → Notifications → enable email for *build failed, deployment failed/crashed, container restarted, job failed, backup failed*, project `siffty`.
  - Integrations via the API/CLI support webhook, Discord and Teams only. If you want Discord, give the agent a webhook URL.
- **UptimeRobot** (free): step 7.

## Timing (approved short cutover: merge and builds happen the day before)

| Step | Estimate |
|---|---|
| 2 scale old to 0 | 1 min |
| 3 dump + counts + import | 3–4 min (small database) |
| 4 flags + migrate + start pre-built images | 2–3 min |
| 5 self-check + counts | 1–2 min |
| 6 domains + certificate check | 1–2 min |
| **Window** | **8–12 min** (target 8–10) |
