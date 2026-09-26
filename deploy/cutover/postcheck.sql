-- Run as the APP user AFTER load + migrate. Prints kinds, counts and
-- migration names only (no role or database names).
\pset footer off

-- 1. Ownership: every APP object in public must be owned by the app user.
--    Objects that belong to Northflank's monitoring extensions are counted separately.
SELECT kind, count(*) FILTER (WHERE NOT ext) AS app_objects,
       count(*) FILTER (WHERE NOT ext AND NOT mine) AS app_objects_not_owned_by_app_user,
       count(*) FILTER (WHERE ext) AS extension_objects_ignored
FROM (
  SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table' WHEN 'S' THEN 'sequence'
                        WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'i' THEN 'index'
                        ELSE c.relkind::text END AS kind,
         c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS mine,
         EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') AS ext
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'i')
  UNION ALL
  SELECT 'enum type', t.typowner = (SELECT oid FROM pg_roles WHERE rolname = current_user),
         EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e'
  UNION ALL
  SELECT 'function', p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user),
         EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
) o
GROUP BY kind ORDER BY kind;

-- 2. Migrations: total, and the ones applied in the last hour (should be exactly the 3 new ones).
SELECT count(*) AS migrations_total,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS migrations_failed_or_rolled_back
FROM _prisma_migrations;
SELECT migration_name, finished_at IS NOT NULL AS finished
FROM _prisma_migrations
WHERE started_at > now() - interval '1 hour'
ORDER BY migration_name;
