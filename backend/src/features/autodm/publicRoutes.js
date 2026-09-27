/**
 * /public/autodm — unauthenticated, because Meta's servers fetch the main
 * message image from here when delivering the DM.
 *
 *   GET /public/autodm/images/:id
 *
 * Unguessable id (crypto.randomUUID), served only while attached to an
 * automation, correct Content-Type + nosniff + inline disposition + cache
 * headers, rate-limited per IP. Not behind AUTODM_ENABLED: an image already
 * referenced by a DM keeps resolving if the feature is switched off (no new
 * DM can reference one while it is off).
 */

const express = require('express');
const { createRateLimiter } = require('../../lib/rateLimit');
const log = require('./log');
const { serveImage } = require('./images');

const router = express.Router();

const imageLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many requests.',
});

router.get('/images/:id', imageLimiter, (req, res) => {
  serveImage(req, res).catch((err) => {
    log.error(`image serve failed (${err && err.code ? err.code : 'error'})`);
    if (!res.headersSent) res.status(500).json({ error: 'Unavailable.' });
  });
});

module.exports = router;
