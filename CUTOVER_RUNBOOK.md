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
| P1 | The Gate 3 rehearsal passed: `release` built, migrated and deployed from `scale-prod`; `api` answered `/livez` and `/health` on its default URL; Redis TLS strict; `max_connections` known and `DB_POOL_SIZE` set | rehearsal log in MIGRATION_LOG.md | all green |
| P2 | `release` workflow trigger = push to `master` only | `northflank get workflow --projectId siffty --workflowId release` shows `branchNamePatterns: ["master"]` and the steps build `master` | yes |
| P3 | `prod-secrets` holds every required key (names only). The two cutover flags are still at rehearsal values: `EMAIL_DRY_RUN=true`, `RUN_IN_PROCESS_SCHEDULER=false` | 🤖 config check, names only | yes |
| P4 | New `api` and `web` at 0 instances, no custom domains | `northflank get service …` | yes |
| P5 | Meta "Server IP allowlist" is empty | 🧑 Meta app → Settings → Advanced | confirmed |
| P6 | Local backup of old prod is fresh (last 24 h) | 🧑 | yes |

## 1. Day before — 🧑, ~5 min

1. **Turn OFF auto-deploy (CI and CD) on BOTH old services, `codeback-backend` and `codeback-frontend`.**
   - Otherwise the step 4 merge deploys the new code to the old project. There, the migration guard crash-loops the old API, and the buildpack build lacks the new Dockerfiles.
   - Check 🤖: `northflank get service --projectId codeback --serviceId codeback-backend` → `disabledCI: true`, `disabledCD: true` (and the same for frontend).
2. Confirm P2 (the new release workflow triggers on `master`).
3. Lower the DNS TTL is **not needed**. Northflank domains move by re-assigning the subdomain inside the same team, and the CNAME target (`*.dns.northflank.app`) does not change. 🤖 confirms this in step 6 by watching the certificate.
4. Open the PR `scale-prod` → `master`, CI green, not merged yet.

## 2. Maintenance starts — 🧑, 1 min

- **Scale old `codeback-backend` to 0.**
  - Meta's webhooks to `api.siffty.com` now get an error, never a 200, so Meta retries them later. Those retries reach the new API after step 6.
  - Users see the app as unavailable.
- Check 🤖: `https://api.siffty.com/health` no longer answers 200. Note the time T0; it is the start of the backfill window for Gate 5.

## 3. Final data copy — 🧑 + 🤖, ~4 min

1. 🧑 `northflank forward addon --projectId codeback --addonId codeback-postgres`, then dump with the **v18** client (a v16 `pg_dump` cannot read the v18 server). Use `host.docker.internal` as the host in the URL:
   ```bash
   MSYS_NO_PATHCONV=1 docker run --rm -v C:/siffty-backup:/out postgres:18-alpine pg_dump --format=plain --no-owner --no-acl --no-comments -f /out/siffty-final.sql "<OLD_DB_URL>"
   ```
2. 🧑 Row counts on the OLD database. Keep the output.
   ```bash
   MSYS_NO_PATHCONV=1 docker run --rm -v C:/codeback/deploy/cutover:/c postgres:18-alpine psql "<OLD_DB_URL>" -f /c/row-counts.sql
   ```
3. 🧑 Northflank → project **`siffty`** → addon **`postgres`** → Backups → **Import** → upload `siffty-final.sql`, then restore it.
   - This replaces the rehearsal schema. The new addon holds nothing else.
   - Check: the import shows COMPLETED.

## 4. Production config, then merge — 🧑 + 🤖, ~5–8 min (builds)

1. 🧑 In `prod-secrets` set **`EMAIL_DRY_RUN=false`** and **`RUN_IN_PROCESS_SCHEDULER=true`**. Cashfree stays `sandbox` until KYC.
2. 🧑 **Merge the PR.** The `release` workflow starts: build `migrate` → run `migrate` (applies the Gate 2/2b/3 migrations to the imported database) → build `api` and `web` in parallel, which deploy through CD.
3. 🤖 Watch the run: every node succeeds. If `migrate` fails, **STOP**: nothing has been deployed yet → rollback.

## 5. Start the new stack + self-check — 🤖, ~2 min

1. `api`: autoscaling ON (min 2, max 6, CPU 70 %, memory 80 %), which starts 2 instances. `web`: autoscaling ON (min 1, max 3). Specs are in `deploy/northflank/api.json` and `web.json`.
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

## 9. Later

- **Cashfree → production** after KYC:
  - 🧑 production keys into `prod-secrets`, whitelist `app.siffty.com`, webhook URL `https://api.siffty.com/webhooks/cashfree`.
  - 🤖 sets `CASHFREE_ENV=production` and `NEXT_PUBLIC_CASHFREE_MODE=production`, then rebuilds `web`.
  - 🧑 makes a real ₹1–10 payment → credits applied once → refund it.
- 🧑 After 7 stable days, delete the old `codeback` project (after one last local backup).
- **Gate 5:** the Instagram Conversations API backfill, run over [T0 − 5 min, T1 + 30 min].

## Monitoring

- **Northflank notifications:**
  - Email alerts are a per-user setting: 🧑 Account → Notifications → enable email for *build failed, deployment failed/crashed, container restarted, job failed, backup failed*, project `siffty`.
  - Integrations via the API/CLI support webhook, Discord and Teams only. If you want Discord, give the agent a webhook URL.
- **UptimeRobot** (free): step 7.

## Timing

| Step | Estimate |
|---|---|
| 2 scale old to 0 | 1 min |
| 3 dump + counts + import | 3–4 min (small database) |
| 4 flags + merge + release (migrate build/run, api/web builds with cache) | 5–8 min |
| 5 scale + self-check + counts | 2 min |
| 6 domains + certificate check | 1–2 min |
| **Window** | **12–17 min** |

The builds in step 4 are the long pole. **Optional (needs your approval):** merge the PR before step 2 with the `release` trigger paused. The builds of the merge commit then already exist, and in step 4 the agent runs the workflow manually with `reuseExistingBuilds: true`, which leaves only `migrate` inside the window. That cuts the window to about 8–10 minutes.
