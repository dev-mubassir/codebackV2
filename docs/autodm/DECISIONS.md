# Auto DM — decisions log

One line per judgment call, with the reason. Order of preference when unsure:
(1) leaves sorting untouched, (2) more secure, (3) simpler and faster.

## Owner decisions (Gate 0, final)
- D1 Branch `feature/autodm` from origin/master @051f9d7; local master untouched.
- D2 Handed-off messages get `aiStatus:'autodm'` in the same transaction that claims the run.
- D3 Disconnect: inert immediately; daily cleanup deletes disconnected accounts' Auto DM data within 24h.
- D4 Touch points limited to the approved list (see GATE_LOG.md per gate).
- D5 Backend in `backend/src/features/autodm/`.
- D6 Auto DM's outgoing messages are not written to `messages`; they show in the run log.
- D7 Advanced Access risk accepted; poll fallback behind `AUTODM_POLL_FALLBACK`.

## Gate 1
- Upstream of `feature/autodm` unset right after branching (git auto-tracked origin/master; a bare `git push` would have targeted master).
- Migration SQL produced with `prisma migrate diff` (schema before → after) instead of `migrate dev`: no shadow DB, no chance of a reset, and the output is exactly the additive diff.
- `prisma format` was NOT kept: it realigned whitespace in existing models. The schema diff is additions only (138 lines added, 0 removed).
- `prisma migrate deploy` on the local dev DB also applied 3 pre-existing pending migrations (20260928…, 20260929…, 20260930…) — local only, required by the current code anyway.
- Migration folder `20261001090000_autodm` sorts after the newest existing migration (20260930090000).
- Table names prefixed `autodm_` (no clash with any existing or orphaned table).
- `userId` is denormalised onto every Auto DM table: every query filters by owner directly, and user deletion cascades even without the account row.
- Arrays (keywords, media ids, public replies) are Postgres `text[]` — no JSON parsing, and Prisma validates types.
- Image ↔ automation link lives on the image (`automationId` unique, cascade): deleting an automation deletes its image, so the public URL 404s.
- Flags are read from `process.env` on every call (never cached), so a restart — or a test — flips them.
- The extra scope and the second subscribe call happen only when `AUTODM_ENABLED` is ALSO true: with the kill switch off the connect flow is byte-identical for everyone.
- `GET /api/autodm/status` requires a session (one PK lookup by requireAuth, no Auto DM query) and returns `{enabled, available}`; `available` = enabled AND allowlisted, and drives the sidebar item, so real users never see a page they cannot use before approval.
- Every other `/api/autodm` route answers 404 `AUTODM_DISABLED` when off or not allowlisted (404, not 403: the feature's existence is not advertised).
- `/api/autodm` mounted before `/api` with a trailing `notFoundHandler`, the same pattern as `/api/admin` and `/api/billing` (the blanket requireAuth on `/api` would otherwise shadow it).
- Rate limiter: the existing `createRateLimiter` keyed per user, 120 requests/minute on `/api/autodm`.
