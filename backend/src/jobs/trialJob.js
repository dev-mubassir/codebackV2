/**
 * Trial lifecycle.
 *
 * WHAT EXPIRY MEANS. On TRIAL_EXPIRED, automatic replies stop and AI
 * classification stops. The inbox stays fully readable and nothing is deleted.
 * The account is NOT locked — a user who cannot log in cannot pay you later,
 * and locking someone out of their own customer conversations to sell them a
 * subscription is hostile.
 *
 * Two sweeps:
 *   expireFinishedTrials()  TRIALING past trialEndsAt -> TRIAL_EXPIRED + email
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

  const due = await prisma.subscription.findMany({
    where: { status: 'TRIALING', trialEndsAt: { lte: now } },
    select: { id: true, userId: true, user: { select: { email: true } } },
  });

  let expired = 0;
  for (const subscription of due) {
    // Conditional on status so two concurrent sweeps cannot both "win" and
    // both send the email.
    const result = await prisma.subscription.updateMany({
      where: { id: subscription.id, status: 'TRIALING' },
      data: { status: 'TRIAL_EXPIRED' },
    });
    if (result.count === 0) continue;

    expired += 1;

    if (subscription.user?.email) {
      try {
        await mailer.sendTrialEnding(subscription.user.email, {
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
 */
async function sendTrialEndingWarnings({ intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  const windowEnd = new Date(now + 24 * 60 * 60 * 1000);
  const windowStart = new Date(now + 24 * 60 * 60 * 1000 - intervalMs);

  const ending = await prisma.subscription.findMany({
    where: {
      status: 'TRIALING',
      trialEndsAt: { gt: windowStart, lte: windowEnd },
    },
    select: { id: true, user: { select: { email: true } } },
  });

  let sent = 0;
  for (const subscription of ending) {
    if (!subscription.user?.email) continue;
    try {
      await mailer.sendTrialEnding(subscription.user.email, {
        daysLeft: 1,
        dashboardUrl: `${frontendUrl()}/dashboard`,
      });
      sent += 1;
    } catch (err) {
      console.error('[Jobs] Trial warning email failed:', err.message);
    }
  }

  if (sent > 0) console.log(`[Jobs] Sent ${sent} trial-ending warning(s).`);
  return sent;
}

module.exports = { expireFinishedTrials, sendTrialEndingWarnings };
