-- Run as the APP user on the fresh, empty database BEFORE loading the dump.
-- Prints booleans and counts only (no role or database names).
\pset footer off
SELECT
  current_setting('server_version_num')::int / 10000                          AS pg_major,
  has_schema_privilege(current_user, 'public', 'CREATE')                      AS can_create_in_public,
  has_schema_privilege(current_user, 'public', 'USAGE')                       AS can_use_public,
  (SELECT datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)
     FROM pg_database WHERE datname = current_database())                      AS owns_database,
  (SELECT pg_has_role(current_user, nspowner, 'USAGE')
     FROM pg_namespace WHERE nspname = 'public')                              AS owns_or_inherits_public_schema,
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)                AS is_superuser,
  (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user)           AS has_createrole,
  has_database_privilege(current_user, current_database(), 'CREATE')          AS can_create_schema_in_db,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public')                                              AS objects_in_public,
  (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e')                          AS enums_in_public,
  EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pooler')                AS pooler_schema_present;

-- Proof by doing: create and drop a scratch table (rolled back either way).
BEGIN;
CREATE TABLE public._siffty_precheck_probe (id int);
SELECT 'create_table_probe: OK' AS result;
ROLLBACK;
