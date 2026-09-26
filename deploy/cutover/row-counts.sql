-- Row counts for every table in the public schema, exact (not estimates).
-- Run on the OLD database (via northflank forward + psql) and on the NEW one
-- (the agent runs src/cli/rowCounts.js on the api). The two lists must match,
-- except _prisma_migrations (the new one gains the Gate 2/2b/3 migrations).
CREATE TEMP TABLE _counts(t text, n bigint);
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('INSERT INTO _counts SELECT %L, count(*) FROM public.%I', r.tablename, r.tablename);
  END LOOP;
END $$;
SELECT t AS "table", n AS "rows" FROM _counts ORDER BY t;
