# Pricing history — archived plan definitions

**Why this file exists.** These three rows lived in a `plans` table created by
migration `20260831071203_add_plan_and_billing_fields`, which was **deleted from
the repo** by the revert of the Cashfree billing work (`39f84a6`). The table
survived only in databases that had already applied that migration, as an orphan
with no file that creates it.

Dropping the orphan is correct — Prisma would otherwise report drift forever —
but dropping it destroys the only surviving record of the pricing that was
designed. Billing returns after Meta App Review, so it is captured here first.

Snapshot taken 2026-09-04 from the local dev database, immediately before the
orphan cleanup. Values are exactly as stored.

## Plans

| slug | name | price (paise) | price (₹) | DM quota | account limit | interval |
|---|---|---|---|---|---|---|
| `starter` | Starter | 49900 | ₹499 | 1,000 | 1 | monthly |
| `growth` | Growth | 149900 | ₹1,499 | 5,000 | 3 | monthly |
| `enterprise` | Enterprise | `null` | — | `null` | `null` | `null` |

`enterprise` was a placeholder — every commercial field null, i.e. "contact us"
rather than a self-serve tier.

Prices are **in paise** (₹1 = 100 paise), which is what the Cashfree integration
expected. `dm_quota` was the monthly AI-classified DM allowance;
`account_limit` the number of connectable Instagram accounts.

## Raw snapshot

```json
[
  {
    "id": "394d3ff5-ed23-4ef2-9f62-594c06308775",
    "slug": "starter",
    "name": "Starter",
    "price_in_paise": 49900,
    "dm_quota": 1000,
    "account_limit": 1,
    "interval": "monthly",
    "created_at": "2026-08-31T07:13:37.093Z",
    "updated_at": "2026-08-31T07:13:37.093Z"
  },
  {
    "id": "9a76d0ba-7e2a-407d-8435-352abb86fa2e",
    "slug": "growth",
    "name": "Growth",
    "price_in_paise": 149900,
    "dm_quota": 5000,
    "account_limit": 3,
    "interval": "monthly",
    "created_at": "2026-08-31T07:13:37.109Z",
    "updated_at": "2026-08-31T07:13:37.109Z"
  },
  {
    "id": "a44d51f5-301b-41a5-8775-13ceb132507d",
    "slug": "enterprise",
    "name": "Enterprise",
    "price_in_paise": null,
    "dm_quota": null,
    "account_limit": null,
    "interval": null,
    "created_at": "2026-08-31T07:13:37.116Z",
    "updated_at": "2026-08-31T07:13:37.116Z"
  }
]
```

## Original `plans` table shape

```sql
CREATE TABLE "plans" (
    "id"             TEXT NOT NULL,
    "slug"           TEXT NOT NULL,   -- UNIQUE
    "name"           TEXT NOT NULL,
    "price_in_paise" INTEGER,
    "dm_quota"       INTEGER,
    "account_limit"  INTEGER,
    "interval"       TEXT,
    "created_at"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP NOT NULL,
    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");
```

`subscriptions.plan_id` referenced this table. That FK died with the old
`subscriptions` table in `20260903120000_remove_subscription_and_usage`.

## Note for whoever restores billing

The `Subscription` model rebuilt in `20260904160000_auth_hardening_baseline` is
**trial-only on purpose** — no plan reference, no provider ids, no price. Its
`status` defaults to `NONE` specifically so that no code path can grant a trial
by creating a row. When billing returns, add the plan relation back; do not
change that default.

See also `FINDINGS.md` C2 — the Cashfree merchant credentials were still present
in the local `.env` after the revert and are being rotated.
