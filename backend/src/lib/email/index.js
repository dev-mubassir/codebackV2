/**
 * The ONLY place email leaves this application.
 *
 * Swapping providers must be a single-file change, so nothing outside this
 * directory may import `resend` or call a provider SDK directly. If you find a
 * bare `resend.emails.send` anywhere else in the codebase, that is a defect.
 *
 * Two transports:
 *   - resend  — used when RESEND_API_KEY is set
 *   - console — used when it is not: logs the full message AND the link, so a
 *               password reset is testable locally without sending anything
 *
 * It NEVER silently no-ops. If a send fails, the caller finds out. Callers then
 * decide whether that failure is fatal (it usually is not — see the note on
 * account enumeration in routes/auth.js).
 */

const templates = require('./templates');

const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@mail.siffty.com';
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || process.env.SUPPORT_EMAIL || undefined;

/**
 * Console transport. Deliberately loud and complete: the whole point is that a
 * developer with no API key can still click through a real reset flow.
 */
const consoleTransport = {
  name: 'console',
  async send({ to, subject, text }) {
    const line = '='.repeat(70);
    // The link is the only thing anyone actually needs from this output, so
    // pull it out rather than making someone hunt through the body.
    const link = (text.match(/https?:\/\/\S+/) || [])[0];
    console.log(
      `\n${line}\n[email:console] TO: ${to}\n[email:console] SUBJECT: ${subject}\n` +
        (link ? `[email:console] LINK: ${link}\n` : '') +
        `${line}\n${text}\n${line}\n`
    );
    return { id: `console-${Date.now()}`, transport: 'console' };
  },
};

/**
 * Resend transport. The SDK is required lazily so that a deployment without
 * RESEND_API_KEY does not need the package present at all.
 */
function createResendTransport(apiKey) {
  let client = null;
  return {
    name: 'resend',
    async send({ to, subject, text, html }) {
      if (!client) {
        const { Resend } = require('resend');
        client = new Resend(apiKey);
      }
      const { data, error } = await client.emails.send({
        from: FROM_EMAIL,
        to: [to],
        subject,
        text,
        html,
        ...(REPLY_TO_EMAIL ? { replyTo: REPLY_TO_EMAIL } : {}),
      });
      // The Resend SDK reports failures in the response body rather than by
      // throwing, so an unchecked call looks successful while sending nothing.
      if (error) {
        const err = new Error(`Resend rejected the message: ${error.message || JSON.stringify(error)}`);
        err.provider = 'resend';
        throw err;
      }
      return { id: data?.id, transport: 'resend' };
    },
  };
}

function pickTransport() {
  const key = (process.env.RESEND_API_KEY || '').trim();
  return key ? createResendTransport(key) : consoleTransport;
}

// Resolved per call rather than cached at module load, so tests can flip the
// env var between cases without re-importing the module.
async function deliver(to, { subject, text, html }) {
  if (!to || typeof to !== 'string') {
    throw new Error('email: refusing to send with no recipient');
  }
  const transport = pickTransport();
  const result = await transport.send({ to, subject, text, html });
  console.log(`[email] sent "${subject}" via ${transport.name} to ${to.replace(/^(.).*(@.*)$/, '$1***$2')}`);
  return result;
}

module.exports = {
  /** Which transport WOULD be used right now. For boot logging and tests. */
  activeTransport: () => pickTransport().name,

  sendPasswordReset: (to, { url, expiresInMinutes }) =>
    deliver(to, templates.passwordReset({ url, expiresInMinutes })),

  sendVerification: (to, { url, expiresInMinutes }) =>
    deliver(to, templates.verification({ url, expiresInMinutes })),

  sendTokenExpiry: (to, { igUsername, reconnectUrl }) =>
    deliver(to, templates.tokenExpiry({ igUsername, reconnectUrl })),

  sendTrialEnding: (to, { daysLeft, dashboardUrl }) =>
    deliver(to, templates.trialEnding({ daysLeft, dashboardUrl })),
};
