-- Retire the legacy admin identities in `users`. HELD FOR OWNER APPROVAL.
--
-- Before the Gate 1 rebuild, admin access came from users.role = 'ADMIN' or
-- an ADMIN_EMAILS match, and the env-credential login created a fake
-- customer row, admin@codeback.internal. None of that grants anything any
-- more (requireAdmin reads admin_users only), but the rows remain.
--
-- WHY NOT JUST DELETE THEM. admin_logs.admin_user_id references users with
-- ON DELETE CASCADE, so deleting a row would silently erase the old audit
-- history that row authored. So, in order:
--
--   1. copy every admin_logs row authored by a legacy admin row into
--      admin_audit_logs (action prefixed LEGACY_, admin_id NULL — those
--      authors are not AdminUsers), so the history survives any later cleanup;
--   2. demote every role = 'ADMIN' row to 'USER' (real customers who were
--      promoted via ADMIN_EMAILS keep their accounts, lose nothing else);
--   3. suspend the fake admin@codeback.internal row so it can never be used
--      as a customer identity. It is NOT deleted (see above).
--
-- Idempotent: step 1 skips rows already copied (matched on the legacy id,
-- kept in `after`), steps 2 and 3 are plain conditional updates.
--
-- REVERSE (manual): role/suspension can be restored from the LEGACY_ rows'
-- `before` values; the copied audit rows can be deleted with
--   DELETE FROM "admin_audit_logs" WHERE "action" LIKE 'LEGACY_%';

INSERT INTO "admin_audit_logs" ("id", "admin_id", "action", "target_type", "target_id", "before", "after", "ip", "created_at")
SELECT
  gen_random_uuid()::text,
  NULL,
  'LEGACY_' || l."action",
  l."target_type",
  l."target_id",
  jsonb_build_object('legacyAdminUserId', l."admin_user_id", 'legacyAdminEmail', u."email"),
  jsonb_build_object('legacyLogId', l."id", 'details', l."details"),
  l."ip_address",
  l."created_at"
FROM "admin_logs" l
JOIN "users" u ON u."id" = l."admin_user_id"
WHERE (u."role" = 'ADMIN' OR u."email" = 'admin@codeback.internal')
  AND NOT EXISTS (
    SELECT 1 FROM "admin_audit_logs" a WHERE a."after"->>'legacyLogId' = l."id"
  );

UPDATE "users" SET "role" = 'USER' WHERE "role" = 'ADMIN';

UPDATE "users" SET "is_suspended" = true, "session_version" = "session_version" + 1
WHERE "email" = 'admin@codeback.internal';
