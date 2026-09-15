-- Must be its OWN migration/transaction: PostgreSQL forbids using a newly
-- added enum value in the same transaction that adds it. The next migration
-- (merge_subscription_into_entitlement) relies on 'NONE' already being
-- committed before it runs.
ALTER TYPE "EntitlementStatus" ADD VALUE 'NONE';
