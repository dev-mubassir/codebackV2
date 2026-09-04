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
  // HARD GUARANTEE: tests never reach a real mailbox.
  //
  // tests/setup/env.js deletes RESEND_API_KEY, but Vitest re-injects
  // backend/.env into process.env AFTER setup files run, so the key is present
  // again by the time a test executes. Without this line the suite would send
  // live email through the production Resend account to non-existent
  // @test.codeback addresses — burning the daily cap and generating hard
  // bounces against the domain real password-reset mail goes out on.
  //
  // Checked here rather than in the test setup because this is the last point
  // before the network, and it cannot be bypassed by env ordering.
  if (process.env.NODE_ENV === 'test') return consoleTransport;

  const key = (process.env.RESEND_API_KEY || '').trim();
  return key ? createResendTransport(key) : consoleTransport;
}

/**
 * Transport health.
 *
 * THE ENUMERATION SUBTLETY. A password-reset send is only ATTEMPTED when the
 * address actually has an account. So if a transport failure produced a
 * different response, that different response would itself prove the address
 * exists — reintroducing exactly the account-enumeration oracle the endpoint
 * is built to prevent.
 *
 * The fix is to make the degraded response address-INDEPENDENT: once a send
 * fails, every forgot-password request gets the degraded answer for the next
 * DEGRADED_TTL_MS, whether or not that address has an account. A transport
 * outage is a property of the mail provider, not of any one address, so
 * reporting it uniformly leaks nothing.
 */
const DEGRADED_TTL_MS = 5 * 60 * 1000;
let degradedUntil = 0;
let lastFailureReason = null;

function markTransportFailed(reason) {
  degradedUntil = Date.now() + DEGRADED_TTL_MS;
  lastFailureReason = reason;
}

function markTransportHealthy() {
  degradedUntil = 0;
  lastFailureReason = null;
}

/** Is the mail transport currently known to be broken? */
function isDegraded() {
  return Date.now() < degradedUntil;
}

function degradedReason() {
  return isDegraded() ? lastFailureReason : null;
}

// Resolved per call rather than cached at module load, so tests can flip the
// env var between cases without re-importing the module.
async function deliver(to, { subject, text, html }) {
  if (!to || typeof to !== 'string') {
    throw new Error('email: refusing to send with no recipient');
  }
  const transport = pickTransport();

  let result;
  try {
    result = await transport.send({ to, subject, text, html });
  } catch (err) {
    // Log the FULL error server-side. This is the only place the provider's
    // own message survives, and it is usually the thing that names the cause
    // ("The mail.siffty.com domain is not verified", say).
    markTransportFailed(err.message);
    console.error(
      `[email] FAILED to send "${subject}" via ${transport.name}: ${err.message}`
    );
    throw err;
  }

  markTransportHealthy();
  console.log(`[email] sent "${subject}" via ${transport.name} to ${to.replace(/^(.).*(@.*)$/, '$1***$2')}`);
  return result;
}

module.exports = {
  /** Which transport WOULD be used right now. For boot logging and tests. */
  activeTransport: () => pickTransport().name,

  /**
   * True when a recent send failed. Callers use this to avoid PROMISING
   * delivery they cannot make — see the enumeration note above for why the
   * degraded response must be returned uniformly, not just to addresses that
   * happen to exist.
   */
  isDegraded,
  degradedReason,
  /**
   * Mark the transport degraded from OUTSIDE this module.
   *
   * Callers invoke this in their own catch blocks so the degraded state does
   * not depend on WHERE the failure was raised. deliver() sets it too, but a
   * caller that wraps or replaces a send would otherwise leave the flag clear
   * and reintroduce the per-address difference this exists to prevent.
   */
  markDegraded: markTransportFailed,
  /** Test seam: clear the degraded flag between cases. */
  _resetHealth: markTransportHealthy,

  sendPasswordReset: (to, { url, expiresInMinutes }) =>
    deliver(to, templates.passwordReset({ url, expiresInMinutes })),

  sendVerification: (to, { url, expiresInMinutes }) =>
    deliver(to, templates.verification({ url, expiresInMinutes })),

  sendTokenExpiry: (to, { igUsername, reconnectUrl }) =>
    deliver(to, templates.tokenExpiry({ igUsername, reconnectUrl })),

  sendTrialEnding: (to, { daysLeft, dashboardUrl }) =>
    deliver(to, templates.trialEnding({ daysLeft, dashboardUrl })),
};
