/**
 * Terminal middleware: unmatched routes, and the final error handler.
 *
 * Extracted rather than inlined in index.js so the TEST HARNESS mounts the
 * identical code. A harness whose error shape differs from production tests
 * nothing about the error shape.
 *
 * Before this existed, nothing was registered after the route mounts, so
 * body-parser failures fell through to Express's default handler and rendered
 * an HTML page containing a stack trace outside production. Adding the 1mb
 * JSON limit made those failures considerably more reachable.
 */

/** Unmatched route. JSON, because every client of this server speaks JSON. */
function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

/**
 * Final error handler.
 *
 * MUST take four arguments — Express identifies error handlers by arity, and
 * dropping `next` silently turns this into ordinary middleware that never runs
 * for errors.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // body-parser tags its own failures with `type`.
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request body is too large.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'That request body is not valid JSON.' });
  }

  const status = err.status || err.statusCode || 500;

  // Log server-side; never send a stack trace to a client in ANY environment.
  // A stack names internal paths, package versions, and often the failing query.
  console.error('[Server] Unhandled error:', err.message);
  if (status >= 500) console.error(err.stack);

  const safeStatus = status >= 400 && status < 600 ? status : 500;
  res.status(safeStatus).json({
    error: safeStatus >= 500 ? 'Something went wrong. Try again.' : err.message || 'Request failed.',
  });
}

module.exports = { notFoundHandler, errorHandler };
