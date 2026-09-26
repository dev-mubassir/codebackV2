/**
 * The ONLY place email leaves this application.
 *
 * Swapping providers must be a single-file change, so nothing outside this
 * directory may import `resend` or call a provider SDK directly. If you find a
 * bare `resend.emails.send` anywhere else in the codebase, that is a defect.
 *
 * Three transports:
 *   - dry-run — EMAIL_DRY_RUN=true: sends NOTHING and logs only the email type
 *               and a hashed recipient. For staging on a copy of real data,
 *               where a real send would mail a real customer.
 *   - resend  — used when RESEND_API_KEY is set
 *   - console — used when it is not: logs the full message AND the link, so a
 *               password reset is testable locally without sending anything.
 *               NEVER in production: that log line carries live reset and
 *               verification tokens (see assertSafeEmailTransport).
 *
 * It NEVER silently no-ops. If a send fails, the caller finds out. Callers then
 * decide whether that failure is fatal (it usually is not — see the note on
 * account enumeration in routes/auth.js).
 */

const templates = require('./templates');
const quota = require('./quota');

/**
 * Renewal reminder stage -> quota type. Kept beside the transport rather than
 * in the job, because the tier a message is billed at is a property of the mail
 * system (quota.js CRITICAL_TYPES), not of whichever caller happens to send it.
 */
const RENEWAL_QUOTA_TYPES = {
  DAY_27: 'renewalDay27',
  DAY_29: 'renewalDay29',
  EXPIRY: 'renewalExpiry',
  GRACE_FINAL: 'renewalGraceFinal',
};

/** Billing alert kind -> quota type. Every one is CRITICAL in quota.js. */
const BILLING_ALERT_TYPES = Object.freeze({
  paidAfterExpiry: 'billingPaidAfterExpiry',
  staleOrdersExpired: 'billingStaleOrdersExpired',
  partialRefund: 'billingPartialRefund',
  refundOutsideSiffty: 'billingRefundOutsideSiffty',
  refundSnapshotMissing: 'billingRefundSnapshotMissing',
});

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

/** A short, stable, non-reversible tag for a recipient — never the address. */
function hashRecipient(to) {
  return require('crypto').createHash('sha256').update(String(to).trim().toLowerCase()).digest('hex').slice(0, 12);
}

/**
 * Dry-run transport. Deliberately TERSE, the opposite of the console one: on
 * staging the recipients are real people, so neither the address nor a single
 * byte of the body (reset links, names) may reach the logs.
 */
const dryRunTransport = {
  name: 'dry-run',
  async send({ to, type }) {
    console.log(`[email:dry-run] type=${type || 'unknown'} to=${hashRecipient(to)} (not sent)`);
    return { id: `dry-run-${Date.now()}`, transport: 'dry-run' };
  },
};

function isDryRun() {
  return String(process.env.EMAIL_DRY_RUN || '').trim().toLowerCase() === 'true';
}

/**
 * Resend transport. The SDK is required lazily so that a deployment without
 * RESEND_API_KEY does not need the package present at all.
 */
function createResendTransport(apiKey) {
  let client = null;
  return {
    name: 'resend',
    async send({ to, subject, text, html, replyTo }) {
      if (!client) {
        const { Resend } = require('resend');
        client = new Resend(apiKey);
      }
      // A per-message replyTo (a contact enquiry, so support can simply hit
      // Reply) wins over the global default.
      const effectiveReplyTo = replyTo || REPLY_TO_EMAIL;
      const { data, error } = await client.emails.send({
        from: FROM_EMAIL,
        to: [to],
        subject,
        text,
        html,
        ...(effectiveReplyTo ? { replyTo: effectiveReplyTo } : {}),
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

/**
 * Domains that CANNOT receive mail, ever.
 *
 * RFC 2606 / RFC 6761 reserve .test, .example, .invalid and .localhost
 * precisely so they can never resolve. `test.codeback` is this project's own
 * fixture domain and is equally undeliverable. A send to any of them can only
 * produce a BOUNCE, and bounces damage the sending reputation of the domain
 * real password resets go out on.
 *
 * This existed as a NODE_ENV=test check, which only covered the vitest suite.
 * It did NOT cover scripts/walkthrough.js, which drives a real server running
 * NODE_ENV=development with a live key — and that produced two real bounces
 * against @test.codeback before this guard was added. Seed scripts, the
 * backfill scripts and the background jobs are all in the same position.
 *
 * Checking the RECIPIENT rather than the environment is what makes this hold
 * for every caller, present and future.
 */
const UNDELIVERABLE_SUFFIXES = [
  '.test',
  '.example',
  '.invalid',
  '.localhost',
  'test.codeback',
  '@example.com',
  '@example.org',
];

function isUndeliverable(address) {
  const a = String(address || '').trim().toLowerCase();
  return UNDELIVERABLE_SUFFIXES.some((suffix) => a.endsWith(suffix));
}

function pickTransport() {
  // Dry-run wins over everything, including a configured provider key: it is
  // the switch that keeps a staging copy of production from mailing customers.
  if (isDryRun()) return dryRunTransport;

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
  if (key) return createResendTransport(key);
  // Production with no provider and no dry-run: refuse rather than print live
  // tokens to the log. assertSafeEmailTransport() stops the boot for this; the
  // throw here is the backstop for anything that sends before or without it.
  if (process.env.NODE_ENV === 'production') return refusingTransport;
  return consoleTransport;
}

const refusingTransport = {
  name: 'refused',
  async send() {
    throw new Error('email: no transport in production (set RESEND_API_KEY, or EMAIL_DRY_RUN=true)');
  },
};

/**
 * Boot check, called from src/index.js: in production the console transport
 * must never be selected, because it logs reset and verification links in
 * full. Throws so the process refuses to start.
 */
function assertSafeEmailTransport() {
  const name = pickTransport().name;
  if (process.env.NODE_ENV === 'production' && (name === 'console' || name === 'refused')) {
    throw new Error(
      'Refusing to start: NODE_ENV=production with no RESEND_API_KEY would use the console email transport, ' +
        'which logs live reset/verification tokens. Set RESEND_API_KEY, or EMAIL_DRY_RUN=true on staging.'
    );
  }
  return name;
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

// Provider send failures, for the admin health page (Gate 3). Timestamps
// only — never the recipient or the message. In memory; a restart clears it.
const sendFailures = [];
function noteSendFailure() {
  const now = Date.now();
  sendFailures.push(now);
  const dayAgo = now - 24 * 60 * 60 * 1000;
  while (sendFailures.length && sendFailures[0] < dayAgo) sendFailures.shift();
}
function sendFailureStats() {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = sendFailures.filter((t) => t >= dayAgo);
  return {
    failures24h: last24h.length,
    lastFailureAt: last24h.length ? new Date(last24h[last24h.length - 1]).toISOString() : null,
    degraded: isDegraded(),
  };
}

// Resolved per call rather than cached at module load, so tests can flip the
// env var between cases without re-importing the module.
async function deliver(to, type, { subject, text, html }, { replyTo } = {}) {
  if (!to || typeof to !== 'string') {
    throw new Error('email: refusing to send with no recipient');
  }

  // Quota BEFORE the transport. Hitting the cap trips the same health gate as
  // a provider outage, so callers get one honest failure mode rather than two:
  // forgot-password already answers 503 uniformly for every address when the
  // transport is degraded, and that behaviour is exactly right here too.
  const allowed = await quota.checkShared(type, to);
  if (!allowed.ok) {
    await quota.recordBlocked(type);
    const { sentToday, cap, reserve } = quota.stats();
    console.error(
      `[email] QUOTA BLOCKED "${subject}" (${type}) — ${allowed.detail}. ` +
        `Today: ${sentToday}/${cap}, ${reserve} reserved for critical sends.`
    );
    // The admin bucket filling up says nothing about whether CUSTOMER mail can
    // be delivered, so it must not flip the degraded flag that forgot-password
    // answers from.
    if (allowed.reason !== 'admin_daily_cap') markTransportFailed(`email quota: ${allowed.detail}`);
    const err = new Error(`Email quota reached: ${allowed.detail}`);
    err.quota = allowed.reason;
    throw err;
  }

  // Never hand an undeliverable address to a real provider. This is checked
  // AFTER the quota (so a blocked fixture send does not consume capacity) and
  // BEFORE the transport is selected for delivery.
  if (isUndeliverable(to) && !['console', 'dry-run'].includes(pickTransport().name)) {
    console.warn(
      `[email] REFUSED to send "${subject}" to an undeliverable address (${hashRecipient(to)}). ` +
        'Reserved/fixture domains can only bounce, and bounces damage sender reputation. ' +
        'Logging instead.'
    );
    // Never the full console dump in production — it would print the body.
    return process.env.NODE_ENV === 'production'
      ? dryRunTransport.send({ to, type })
      : consoleTransport.send({ to, subject, text, html });
  }

  const transport = pickTransport();

  let result;
  try {
    result = await transport.send({ to, subject, text, html, replyTo, type });
  } catch (err) {
    // Log the FULL error server-side. This is the only place the provider's
    // own message survives, and it is usually the thing that names the cause
    // ("The mail.siffty.com domain is not verified", say).
    markTransportFailed(err.message);
    noteSendFailure();
    console.error(
      `[email] FAILED to send "${subject}" via ${transport.name}: ${err.message}`
    );
    throw err;
  }

  // Consume quota only on SUCCESS — a provider failure must not burn capacity
  // that a later, working send needs.
  await quota.recordSendShared(type, to);
  markTransportHealthy();

  const { sentToday, cap } = quota.stats();
  console.log(
    `[email] sent "${subject}" via ${transport.name} to ${to.replace(/^(.).*(@.*)$/, '$1***$2')} [${sentToday}/${cap} today]`
  );
  return result;
}

module.exports = {
  /** Which transport WOULD be used right now. For boot logging and tests. */
  activeTransport: () => pickTransport().name,
  assertSafeEmailTransport,

  /**
   * True when a recent send failed. Callers use this to avoid PROMISING
   * delivery they cannot make — see the enumeration note above for why the
   * degraded response must be returned uniformly, not just to addresses that
   * happen to exist.
   */
  isDegraded,
  degradedReason,
  /** Provider send failures in the last 24h (admin health page). */
  sendFailureStats,
  /**
   * Mark the transport degraded from OUTSIDE this module.
   *
   * Callers invoke this in their own catch blocks so the degraded state does
   * not depend on WHERE the failure was raised. deliver() sets it too, but a
   * caller that wraps or replaces a send would otherwise leave the flag clear
   * and reintroduce the per-address difference this exists to prevent.
   */
  markDegraded: markTransportFailed,
  /** Exposed so tests and scripts can assert the guard's coverage. */
  isUndeliverable,
  /** Test seam: clear the degraded flag between cases. */
  _resetHealth: markTransportHealthy,

  // CRITICAL — someone is blocked right now and waiting on this.
  sendPasswordReset: (to, { url, expiresInMinutes }) =>
    deliver(to, 'passwordReset', templates.passwordReset({ url, expiresInMinutes })),

  sendVerification: (to, { url, expiresInMinutes }) =>
    deliver(to, 'verification', templates.verification({ url, expiresInMinutes })),

  // DEFERRABLE — informational; yields headroom to the two above.
  sendTokenExpiry: (to, { igUsername, reconnectUrl }) =>
    deliver(to, 'tokenExpiry', templates.tokenExpiry({ igUsername, reconnectUrl })),

  sendTrialEnding: (to, { daysLeft, dashboardUrl }) =>
    deliver(to, 'trialEnding', templates.trialEnding({ daysLeft, dashboardUrl })),

  // CRITICAL — internal ops alert, not customer-facing. See quota.js's
  // CRITICAL_TYPES comment: money is unaccounted for until a human looks.
  sendBillingReconciliationMismatch: (to, { mismatches, checked }) =>
    deliver(to, 'billingReconciliationMismatch', templates.billingReconciliationMismatch({ mismatches, checked })),

  // CRITICAL — internal ops alert: a downgrade was granted during an active
  // paid plan, after the money was taken. See entitlementService.alertPlanAnomaly.
  sendBillingPlanAnomaly: (to, details) => deliver(to, 'billingPlanAnomaly', templates.billingPlanAnomaly(details)),

  // CRITICAL — internal billing alerts (lib/billingAlerts.js). One quota type
  // per kind, so a burst of one kind can never throttle a different one.
  sendBillingOpsAlert: (to, { kind, details }) => {
    const type = BILLING_ALERT_TYPES[kind];
    if (!type) throw new Error(`email.sendBillingOpsAlert: unknown kind "${kind}"`);
    return deliver(to, type, templates.billingOpsAlert({ kind, details }));
  },
  BILLING_ALERT_TYPES,

  /**
   * The paid renewal sequence. MIXED TIER — this is the one sender whose
   * criticality depends on its argument, which is why it maps reminderType to
   * a distinct quota type rather than sending everything as "renewalReminder".
   *
   * The quota layer decides critical-vs-deferrable purely from `type` (see
   * quota.js CRITICAL_TYPES), so a single shared type would force one answer
   * for all four stages: either the day-27 nudge gets to eat the password-reset
   * reserve, or the expiry-day notice — the customer's last chance to keep
   * service running — gets starved by a day of nudges. Four types is what lets
   * the same sender be deferrable early and critical late.
   *
   * Splitting by type also means the per-recipient hourly throttle is counted
   * per stage, so a retry of one stage can never suppress a different one.
   */
  sendRenewalReminder: (to, { reminderType, unusedCredits, checkoutUrl, forfeitAt = null }) => {
    const type = RENEWAL_QUOTA_TYPES[reminderType];
    // Fail loudly rather than defaulting to a deferrable type: a typo'd
    // reminderType that silently became deferrable would quietly downgrade the
    // expiry notice, and nothing downstream would ever report it.
    if (!type) {
      throw new Error(`email.sendRenewalReminder: unknown reminderType "${reminderType}"`);
    }
    // forfeitAt is the tenant's own graceUntil. Only GRACE_FINAL renders it,
    // but it is passed for every stage so the sender has no per-stage special
    // case to get wrong.
    return deliver(to, type, templates.renewalReminder({ reminderType, unusedCredits, checkoutUrl, forfeitAt }));
  },

  /**
   * DEFERRABLE — a visitor's message from the contact page, to SUPPORT_EMAIL.
   * Two quota types, so Enterprise and support enquiries stay separable in the
   * quota and the logs. Reply-To is the visitor's address, so answering is one
   * click — that address is self-reported, which the template says outright.
   */
  sendContactEnquiry: (to, { kind, ...details }) => {
    const type = { support: 'supportEnquiry', enterprise: 'enterpriseEnquiry' }[kind];
    if (!type) throw new Error(`email.sendContactEnquiry: unknown kind "${kind}"`);
    return deliver(to, type, templates.contactEnquiry({ kind, ...details }), { replyTo: details.fromEmail });
  },

  /**
   * ADMIN bucket (quota.js ADMIN_TYPES) — its own 10/day cap, outside the
   * shared cap and never touching the customer critical reserve. Lockouts
   * are the bucket's own critical tier: 3 of the 10 are held back for them.
   * kind: 'login' | 'lockout'.
   */
  /** ADMIN bucket, routine tier — operational alerts (lib/adminAlerts.js). */
  sendAdminOpsAlert: (to, { title, lead, facts }) =>
    deliver(to, 'adminOpsAlert', templates.adminOpsAlert({ title, lead, facts })),

  sendAdminSecurityAlert: (to, { kind, facts }) =>
    deliver(to, kind === 'lockout' ? 'adminLockoutAlert' : 'adminLoginAlert', templates.adminSecurityAlert({ kind, facts })),

  sendDeletionConfirmation: (to, { igUsername, accountDeleted, confirmationCode, statusUrl }) =>
    deliver(
      to,
      'deletionConfirmation',
      templates.deletionConfirmation({ igUsername, accountDeleted, confirmationCode, statusUrl })
    ),

  /**
   * Exposed so the renewal tests can assert the tiering contract directly —
   * that EXPIRY and GRACE_FINAL land on quota types inside CRITICAL_TYPES —
   * instead of inferring it by exhausting the daily cap.
   */
  RENEWAL_QUOTA_TYPES,

  /** Current quota position, for boot logging and tests. */
  quotaStats: quota.stats,
  _resetQuota: quota._reset,
};
