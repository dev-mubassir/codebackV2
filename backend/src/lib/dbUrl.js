/**
 * The Postgres connection string, resolved once at process start.
 *
 * Northflank's HA Postgres addon (2+ replicas) links a POSTGRES_URI that
 * Prisma rejects ("invalid port number"): with replicas it is not a plain
 * single-host URL. The addon also links the parts separately, so when they
 * are present the URL is BUILT from them — single host (the primary),
 * username/password/database percent-encoded — and that wins over
 * DATABASE_URL. Without the parts (local dev, tests, the old project),
 * DATABASE_URL is used unchanged.
 *
 *   DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME   linked from the addon
 *   DB_SSLMODE                                    default 'require' (the addon runs TLS)
 *
 * Never logs the result.
 */

function resolveDatabaseUrl(env = process.env) {
  const host = (env.DB_HOST || '').trim();
  const user = env.DB_USER;
  const password = env.DB_PASSWORD;
  const name = (env.DB_NAME || '').trim();
  if (!host || !user || password === undefined || !name) return env.DATABASE_URL;

  // A multi-host value lists the primary first; a host that already carries
  // its port keeps it.
  const first = host.split(',')[0].trim();
  const hostPort = /:\d+$/.test(first) ? first : `${first}:${(env.DB_PORT || '5432').trim()}`;
  const sslmode = (env.DB_SSLMODE || 'require').trim();
  const e = encodeURIComponent;
  return `postgresql://${e(user)}:${e(password)}@${hostPort}/${e(name)}?sslmode=${e(sslmode)}`;
}

/** Resolve and store in process.env.DATABASE_URL, before anything reads it. */
function applyDatabaseUrl(env = process.env) {
  const url = resolveDatabaseUrl(env);
  if (url) env.DATABASE_URL = url;
  return Boolean(url);
}

module.exports = { resolveDatabaseUrl, applyDatabaseUrl };
