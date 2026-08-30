/**
 * Session helpers for privilege transitions.
 *
 * Every login, registration, and OAuth completion must issue a NEW session
 * id. Writing `userId` onto the session id the client already presented lets
 * an attacker who planted a valid signed cookie ride the victim's login —
 * session fixation. express-session does not regenerate on its own.
 */

/** Promise wrapper around req.session.regenerate(). */
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.regenerate !== 'function') return resolve();
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/** Promise wrapper around req.session.save(). */
function saveSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.save !== 'function') return resolve();
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Regenerate the session, then apply `values` to the fresh one and persist it.
 * regenerate() discards all existing session data, so anything that must
 * survive the transition has to be passed in here.
 */
async function startAuthenticatedSession(req, values = {}) {
  await regenerateSession(req);
  Object.assign(req.session, values);
  await saveSession(req);
}

module.exports = { regenerateSession, saveSession, startAuthenticatedSession };
