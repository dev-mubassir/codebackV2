/**
 * Trial lifecycle, operating on Entitlement (which absorbed the old
 * trial-only Subscription model — see schema.prisma's Entitlement comment).
 *
 * WHAT EXPIRY MEANS. On EXPIRED, automatic replies stop and AI classification
 * stops. The inbox stays fully readable and nothing is deleted. The account
 * is NOT locked — a user who cannot log in cannot pay you later, and locking
 * someone out of their own customer conversations to sell them a plan is
 * hostile. A trial has no grace stage (see Entitlement's schema comment), so
 * TRIALING transitions straight to EXPIRED here, same as before.
 *
 * Two sweeps, scoped to planCode 'TRIAL' — a paid tenant's ACTIVE -> GRACE ->
 * EXPIRED transition is a separate, not-yet-built Gate 4 sweep, not this one:
 *   expireFinishedTrials()  TRIALING past validUntil -> EXPIRED + email
 *   sendTrialEndingWarnings() one warning per trial, the day before it ends
 */

const prisma = require('../lib/prisma');
// Bound as `mailer`, never `email` — see routes/auth.js. A local `email`
// variable shadowing this module silently broke registration once already.
const mailer = require('../lib/email');

const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * Flip trials that have run out.
 *
 * The status change is a conditional updateMany per row rather than a bulk
 * update, so the email is only sent by the run that actually performed the
 * transition. A bulk update followed by a send would mail every user again on
 * every sweep if the send failed partway.
 */
async function expireFinishedTrials() {
  const now = new Date();

  const due = await prisma.entitlement.findMany({
    where: { planCode: 'TRIAL', status: 'TRIALING', validUntil: { lte: now } },
    select: { id: true, userId: true, user: { select: { email: true } } },
  });

  let expired = 0;
  for (const entitlement of due) {
    // Conditional on status so two concurrent sweeps cannot both "win" and
    // both send the email.
    const result = await prisma.entitlement.updateMany({
      where: { id: entitlement.id, status: 'TRIALING' },
      data: { status: 'EXPIRED' },
    });
    if (result.count === 0) continue;

    expired += 1;

    if (entitlement.user?.email) {
      try {
        await mailer.sendTrialEnding(entitlement.user.email, {
          daysLeft: 0,
          dashboardUrl: `${frontendUrl()}/dashboard`,
        });
      } catch (err) {
        // The status change already happened and is the important half. A
        // failed email must not roll it back or repeat the transition.
        console.error('[Jobs] Trial expiry email failed:', err.message);
      }
    }
  }

  if (expired > 0) console.log(`[Jobs] Expired ${expired} trial(s).`);
  return expired;
}

/**
 * Warn once, roughly a day out.
 *
 * "Roughly" is deliberate: the window is bounded on both sides so a sweep that
 * runs hourly does not send 24 emails. Anything already inside the window when
 * the previous sweep ran has been warned.
 *
 * ONCE is enforced, not assumed: each warning is CLAIMED by stamping
 * trialWarningSentAt with a conditional update before the send. The window
 * alone used to be the only guard, so a restart or a second instance running
 * the same sweep inside one window mailed the same user twice. Only the run
 * whose update changed the row sends; a failed send releases the claim.
 */
async function sendTrialEndingWarnings({ intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  const windowEnd = new Date(now + 24 * 60 * 60 * 1000);
  const windowStart = new Date(now + 24 * 60 * 60 * 1000 - intervalMs);

  const ending = await prisma.entitlement.findMany({
    where: {
      planCode: 'TRIAL',
      status: 'TRIALING',
      validUntil: { gt: windowStart, lte: windowEnd },
      trialWarningSentAt: null,
    },
    select: { id: true, user: { select: { email: true } } },
  });

  let sent = 0;
  for (const entitlement of ending) {
    if (!entitlement.user?.email) continue;

    const claim = await prisma.entitlement.updateMany({
      where: { id: entitlement.id, trialWarningSentAt: null },
      data: { trialWarningSentAt: new Date() },
    });
    if (claim.count === 0) continue; // another run got there first

    try {
      await mailer.sendTrialEnding(entitlement.user.email, {
        daysLeft: 1,
        dashboardUrl: `${frontendUrl()}/dashboard`,
      });
      sent += 1;
    } catch (err) {
      console.error('[Jobs] Trial warning email failed:', err.message);
      // Release the claim so a later run inside the window can try again.
      await prisma.entitlement
        .updateMany({ where: { id: entitlement.id }, data: { trialWarningSentAt: null } })
        .catch((e) => console.error('[Jobs] Could not release the trial-warning claim:', e.message));
    }
  }

  if (sent > 0) console.log(`[Jobs] Sent ${sent} trial-ending warning(s).`);
  return sent;
}

module.exports = { expireFinishedTrials, sendTrialEndingWarnings };
