# Auto DM — gate log

Branch `feature/autodm` (from origin/master @051f9d7). Local commits only; never pushed.
Baseline (Gate 0, on code identical to origin/master): 71 files (70 passed, 1 skipped), 806 tests: 794 passed, 12 skipped, 0 failed.

---

## Gate 1 — schema, migration, config, status route

**Built**
- `backend/prisma/schema.prisma`: 4 new models — `AutoDmAccountState`, `AutoDmAutomation`, `AutoDmRun`, `AutoDmImage` (tables `autodm_*`).
- `backend/prisma/migrations/20261001090000_autodm/migration.sql`: CREATE TABLE ×4, CREATE INDEX ×13 (4 unique), FOREIGN KEY ×9 — all FKs are on the new tables, referencing `users`, `instagram_accounts` and each other, all `ON DELETE CASCADE`. Checked by a grep that fails on any other statement type: none found. Applied to the local dev DB (`localhost:55432/codeback`) and the test DB (`codeback_test`) only.
- `backend/src/features/autodm/`: `config.js` (AUTODM_ENABLED, AUTODM_SCOPE_ALLOWLIST, AUTODM_SCOPE_ALL, AUTODM_POLL_FALLBACK), `log.js`, `routes.js` (`GET /api/autodm/status` + the disabled gate), `publicRoutes.js` (empty until Gate 2), `index.js` (the only entry point).
- `backend/tests/autodm-status.test.js` (new, 8 tests).

**Existing files touched**
| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | +138 lines, 0 removed: back-relation fields on `User` (4) and `InstagramAccount` (3) — no columns — and the 4 new models appended at the end. |
| `backend/src/index.js` | +5 lines after the `/data-deletion` mount: comment + `app.use('/public/autodm', …publicRouter)` + `app.use('/api/autodm', …apiRouter, notFoundHandler)`. |

**Tests**: `autodm-status.test.js` 8/8 passed. Full suite runs at Gates 2 and 4.

**Security checks**
- Status route needs a session; no Auto DM DB query anywhere yet.
- All other routes 404 when off or when the user is not allowlisted.
- Per-user rate limiter on the whole router.
- Migration: additive only; no existing table altered.

**Risks**: none new. FK creation briefly locks `users` / `instagram_accounts` at deploy (empty new tables, instant).
