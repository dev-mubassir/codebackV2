-- Remove the subscription/usage scaffolding. No subscription/billing feature
-- remains in the Prisma schema, so drop the tables that backed it. Neither
-- table is referenced by any foreign key from a surviving table, so a plain
-- DROP TABLE is sufficient (both only held an outgoing FK to "users").

-- DropTable
DROP TABLE "usage_events";

-- DropTable
DROP TABLE "subscriptions";
