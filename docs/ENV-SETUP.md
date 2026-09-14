# Environment and deploy setup

> Names and descriptions only. **No values appear in this file, ever** —
> not examples, not placeholders that look real, not "expired" ones.

Sections 2–4 (the variable tables, the readiness check, and what to expect
in the Cashfree dashboard) are added by a later part of this work. This
document currently covers the deploy sequence.

---

## 1. Deploy sequence — read before the first deploy of the billing work

### The gap this exists to close

Code and schema are deployed by **two different mechanisms, at two
different times**:

| | Trigger | Who runs it |
|---|---|---|
| **Code** | push to `master` | Northflank, automatically |
| **Schema** | `prisma migrate deploy` | a human, by hand, in the service shell |

There is no release command, no Dockerfile migration, and no entrypoint
migration — `npm start` is bare `node src/index.js`. That decoupling is
deliberate (`docs/DEPLOYMENT-RUNBOOK.md` PHASE 4: *"Manually, in the service
shell. Never on container start"*), because an automatic migration on every
container start is its own class of outage.

But it means **merging to `master` puts new code live against the old
schema** until someone runs the migration, and the window stays open
indefinitely if that step is forgotten.

### Why that is not a small window

Prisma Client SELECTs every column its schema declares. A client built from
a schema containing `entitlements.region_source` emits that column against a
database that does not have it yet, and **every full-row entitlement query
throws**.

`claimInstagramIdentity()` reads and writes the full entitlement row inside a
transaction, so the transaction aborts and **Instagram connect fails for
every user** — including with `BILLING_ENABLED` off, because the trial grant
is not behind that flag and must not be. Meanwhile `/health` still returns
200 and nothing else misbehaves. It is silent.

This is not hypothetical. It happened on the local development database
during this work and is exactly how it presented: connect broken, everything
else fine, no error anywhere obvious.

### The guard

`backend/src/lib/migrationGuard.js` runs before the HTTP socket opens. It
compares migration folders on disk against `_prisma_migrations`, and if the
database is behind it **prints the missing migration names and exits(1)**.

- It **does not run migrations.** Reporting only — running them here would
  reintroduce the container-start migration the runbook rules out.
- A database that is *unreachable* at boot is a warning, not a fatal: that is
  a transient condition the app already handles per-request, and refusing to
  start would turn a blip into an outage needing a human. Only a database we
  can read, and which is definitively behind, stops the boot.

A process that refuses to start is loud and diagnosed in seconds. A process
serving a broken connect flow costs signups until someone reports it.

### The correct order

```bash
# 1. Merge to master. Northflank deploys the code.
#    The new container WILL refuse to start if the schema is behind —
#    that is the guard doing its job, not a broken deploy.

# 2. In the Northflank service shell, apply the schema:
./node_modules/.bin/prisma migrate deploy

# 3. Restart / redeploy the service. The guard now passes and it serves.
```

If step 2 is skipped, step 3 never comes up healthy and the logs name the
exact missing migrations.

### One-off: adopting `user_sessions`

`connect-pg-simple` creates its own session table at runtime, so on any
database where the app has already run, `user_sessions` **already exists**
and `20260914064610_adopt_user_sessions` will fail with
`relation "user_sessions" already exists`.

Adopt it instead of running it — this records the migration as applied
without executing its SQL:

```bash
./node_modules/.bin/prisma migrate resolve --applied 20260914064610_adopt_user_sessions
```

Then continue with `migrate deploy`. This exact sequence was rehearsed on
the local development database and is what repaired it. On a genuinely fresh
database that has never run the app, the migration applies normally and no
resolve is needed.

### Migrations deliberately held back

`backend/prisma/pending-approval/` contains finished migrations that **must
not run yet**, kept out of `prisma/migrations/` because `migrate deploy`
applies *everything* it finds there — there is no "apply all but this one".

Currently held: `20260914064620_drop_subscriptions_legacy`, the irreversible
destruction of the pre-Entitlement trial data. It waits on a production
survey, a verified backfill, and explicit owner approval. See that folder's
README for how to promote one.
