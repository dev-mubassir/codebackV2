/**
 * Contact and Enterprise enquiries — the form on /contact and /contact/enterprise.
 *
 * PUBLIC, SESSION-OPTIONAL. A visitor who cannot log in is exactly the person
 * most likely to need support, so no session is required. When one exists, the
 * account is read from it — never from the typed email — and the email to
 * support says which of the two it is, so nobody acts on an account because a
 * form claimed to own it.
 *
 * NOT BEHIND BILLING_ENABLED. Support cannot depend on a billing flag: someone
 * blocked from a trial, or asking before billing launches, still has to reach
 * a person.
 *
 * ONE EMAIL EGRESS. Mail goes through lib/email (mailer.sendContactEnquiry),
 * the only place email leaves this application. This route never talks to a
 * provider itself.
 *
 * Abuse controls: a per-IP limiter per endpoint, a honeypot field that a human
 * never sees, strict schemas (unknown keys are a 400), bounded field sizes, and
 * the email quota's daily cap behind all of it.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
// Bound as `mailer`, never `email` — see routes/auth.js.
const mailer = require('../lib/email');
const { createRateLimiter } = require('../lib/rateLimit');
const { validate, z, fields } = require('../middleware/validate');

const UNAVAILABLE = "Your message couldn't be sent right now. Please email us directly.";

/** Five messages an hour per address, per endpoint — generous for a person, useless for a flood. */
const contactLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many messages from this connection. Please email us directly.',
});

const base = {
  name: z.string().trim().min(1, 'enter your name').max(120, 'that name is too long'),
  email: fields.email,
  message: z.string().trim().min(10, 'tell us a little more (at least 10 characters)').max(5000, 'keep it under 5,000 characters'),
  // Honeypot. Hidden from people, filled in by naive bots.
  website: z.string().max(200).optional(),
};

const schemas = {
  support: z.object(base).strict(),
  enterprise: z
    .object({
      ...base,
      company: z.string().trim().min(1, 'enter your company or brand').max(160, 'that name is too long'),
      igAccounts: z.string().trim().max(40, 'keep it short').optional(),
    })
    .strict(),
};

/** The signed-in account, from the session only. Null for a visitor, or if the lookup fails. */
async function sessionAccount(req) {
  const userId = req.session?.userId;
  if (!userId) return null;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    return user ? { userId: user.id, email: user.email } : null;
  } catch (err) {
    // An enquiry is still worth delivering without the account attached.
    console.error('[Contact] Session account lookup failed:', err.message);
    return null;
  }
}

function handleEnquiry(kind) {
  return async (req, res) => {
    const { website, name, email, message, company, igAccounts } = req.body;

    if (website) {
      // Answer exactly as a success would, so a bot learns nothing.
      console.warn(`[Contact] Dropped a ${kind} enquiry that filled the honeypot field.`);
      return res.status(200).json({ ok: true });
    }

    const to = (process.env.SUPPORT_EMAIL || '').trim();
    if (!to) {
      console.error(`[Contact] SUPPORT_EMAIL is not set — a ${kind} enquiry could not be delivered (sender not logged).`);
      return res.status(503).json({ error: UNAVAILABLE });
    }

    const account = await sessionAccount(req);

    try {
      await mailer.sendContactEnquiry(to, { kind, name, fromEmail: email, company, igAccounts, message, account });
    } catch (err) {
      console.error(`[Contact] Failed to deliver a ${kind} enquiry:`, err.message);
      return res.status(503).json({ error: UNAVAILABLE });
    }

    console.log(`[Contact] Delivered a ${kind} enquiry${account ? ` from account ${account.userId}` : ''}.`);
    return res.status(200).json({ ok: true });
  };
}

router.post('/support', contactLimiter, validate({ body: schemas.support }), handleEnquiry('support'));
router.post('/enterprise', contactLimiter, validate({ body: schemas.enterprise }), handleEnquiry('enterprise'));

module.exports = router;
