# Migrations held back from the queue

Anything in this folder is a real, finished migration that **must not run
yet**. It is kept OUT of `prisma/migrations/` on purpose.

## Why not just leave it in `prisma/migrations/` unapplied?

Because `prisma migrate deploy` applies **every** pending migration it
finds, in name order. There is no "apply all but this one". An earlier
version of this work left `drop_subscriptions_legacy` sitting in the
migrations directory with a deliberately-late timestamp, on the theory that
nothing after it would force it to run — but that only stops a LATER
migration from dragging it in. It does nothing about a plain
`prisma migrate deploy`, which is exactly what PHASE 4 of
`docs/DEPLOYMENT-RUNBOOK.md` tells the operator to run.

So the next routine production migration would have destroyed the table
before anyone verified the backfill against real data — the precise outcome
the ruling forbade. A migration that must not run does not belong in the
directory that means "run these".

## Contents

### `20260914064620_drop_subscriptions_legacy`

Drops `subscriptions_legacy_20260914` (renamed, not dropped, by
`20260914055144_merge_subscription_into_entitlement`) and the
`SubscriptionStatus` enum its status column still depends on.

This is the final, irreversible destruction of the pre-Entitlement trial
data. It waits for:

1. Production surveyed (`backend/scripts/prod-readonly-survey.js`), and
2. The Entitlement backfill confirmed correct against real production rows, and
3. Explicit owner approval.

## How to promote one when approved

```bash
git mv prisma/pending-approval/<name> prisma/migrations/<name>
npx prisma migrate deploy     # now, and only now, it runs
```

Nothing else changes — the SQL is already written and reviewed.
