/**
 * Shared HTTP security helpers: a strict CORS allowlist, a defense-in-depth
 * CSRF/origin guard for state-changing requests, and baseline security
 * response headers. Dependency-free (no helmet/csurf needed).
 */

const isProduction = process.env.NODE_ENV === 'production';

function stripTrailingSlash(value) {
  return typeof value === 'string' ? value.replace(/\/$/, '') : value;
}

/**
 * Build the set of origins allowed to make credentialed cross-origin
 * requests. Sourced from FRONTEND_URL, BACKEND_URL, and an optional
 * comma-separated ALLOWED_ORIGINS env var. In non-production, common local
 * dev origins are added automatically.
 */
function buildAllowlist() {
  const list = new Set();
  const add = (v) => {
    const normalized = stripTrailingSlash(v);
    if (normalized) list.add(normalized);
  };

  add(process.env.FRONTEND_URL);
  add(process.env.BACKEND_URL);
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach(add);

  if (!isProduction) {
    add('http://localhost:3000');
    add('http://127.0.0.1:3000');
    add('http://localhost:5000');
  }

  return list;
}

const ALLOWLIST = buildAllowlist();

/**
 * A missing origin (non-browser clients, same-origin server-to-server calls,
 * Meta webhooks) is allowed — those paths are authenticated by session or
 * HMAC, not by Origin. Any *present* origin must be on the allowlist. Local
 * dev hostnames on any port are permitted outside production only.
 */
function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = stripTrailingSlash(origin);
  if (ALLOWLIST.has(normalized)) return true;
  if (
    !isProduction &&
    /^https?:\/\/(localhost|127\.0\.0\.1|local\.codeback\.test)(:\d+)?$/.test(normalized)
  ) {
    return true;
  }
  return false;
}

/**
 * Options for the `cors` package. Unknown origins are answered *without* the
 * Access-Control-Allow-Origin header (callback(null, false)) so the browser
 * blocks the response — never reflect an arbitrary origin alongside
 * credentials.
 */
const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Defense-in-depth CSRF mitigation. Cookie-authenticated browsers always send
 * an Origin header on cross-site POST/PUT/PATCH/DELETE, so rejecting a present
 * but non-allowlisted Origin/Referer blocks CSRF without per-form tokens.
 * Requests with no Origin/Referer (server-to-server, Meta webhooks) are left
 * to their own auth (session / HMAC) and pass through.
 */
function originGuard(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();

  let source = req.get('origin');
  if (!source) {
    const referer = req.get('referer');
    if (referer) {
      try {
        source = new URL(referer).origin;
      } catch {
        source = null;
      }
    }
  }

  if (source && !isAllowedOrigin(source)) {
    return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  return next();
}

/**
 * Baseline security headers for every response. The backend serves JSON and a
 * couple of tiny text/redirect responses, so a locked-down CSP is safe.
 */
/**
 * HELMET IS DELIBERATELY NOT USED. See FINDINGS.md D1.
 *
 * res.setHeader overwrites rather than merges, so adding helmet after this
 * middleware would be a REGRESSION, not an improvement: X-Frame-Options would
 * drop from DENY to helmet's SAMEORIGIN and the CSP would loosen from
 * default-src 'none' to 'self'. Its HSTS is also unconditional, which — given
 * this server serves HTTPS locally whenever backend/certs exists — would pin
 * local.codeback.test in every developer's browser for a year.
 *
 * The headers below that helmet would otherwise have contributed were reviewed
 * individually and the genuinely useful ones added.
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  );

  // Added from the helmet review (D1). This API serves JSON to its own
  // frontend; no other origin has any business embedding its responses.
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  // Hints that this origin gets its own agent cluster, limiting what a
  // same-site-but-different-origin document can reach.
  res.setHeader('Origin-Agent-Cluster', '?1');
  // Explicitly OFF. The legacy XSS auditor introduced its own vulnerabilities
  // and is disabled in every current browser; setting 0 is the recommendation.
  res.setHeader('X-XSS-Protection', '0');
  // No Flash/Acrobat cross-domain policy files are served from here.
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // Do not resolve DNS for links appearing in responses.
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  // Never advertise the framework.
  res.removeHeader('X-Powered-By');

  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

module.exports = {
  corsOptions,
  isAllowedOrigin,
  originGuard,
  securityHeaders,
  buildAllowlist,
};
