/**
 * Renewal reminders for manual-renewal subscriptions.
 *
 * Only meaningful while CASHFREE_SUBSCRIPTIONS_ENABLED is false (see
 * routes/billing.js) — Subscriptions autopay renews on its own and never
 * needs a "pay now" nudge. The sweep itself is gated on that flag in
 * jobs/index.js, not here, so this file stays a plain query+notify and the
 * on/off decision lives in one place.
 *
 * In-app only — no email infrastructure exists in this codebase.
 *
 * Idempotent per subscription via the same pattern as the other sweeps in
 * this directory: an atomic conditional updateMany claims the row (only
 * proceeds if lastRenewalReminderSentAt is still null at claim time) before
 * notifying, so two concurrent runs can't both claim the same subscription
 * and double-notify.
 */

const prisma = require('../lib/prisma');
const { notifyRenewalReminder } = require('../lib/notify');

const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

async function sendRenewalReminders() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);

  // status: 'active' — a cancelled or past_due subscription may still carry
  // a future currentPeriodEnd (neither transition clears it), but "renews
  // soon" is the wrong message for a tenant who isn't currently paying and
  // in good standing.
  const dueSubscriptions = await prisma.subscription.findMany({
    where: {
      status: 'active',
      currentPeriodEnd: { gte: now, lte: windowEnd },
      lastRenewalReminderSentAt: null,
    },
    select: { id: true, userId: true, currentPeriodEnd: true, plan: { select: { name: true } } },
  });

  let sent = 0;
  for (const subscription of dueSubscriptions) {
    const claimed = await prisma.subscription.updateMany({
      where: { id: subscription.id, lastRenewalReminderSentAt: null },
      data: { lastRenewalReminderSentAt: now },
    });
    if (claimed.count !== 1) continue; // another run already claimed it

    await notifyRenewalReminder(subscription.userId, {
      planName: subscription.plan?.name || 'your',
      currentPeriodEnd: subscription.currentPeriodEnd,
    });
    sent++;
  }

  if (sent > 0) {
    console.log(`[RenewalReminder] Sent ${sent} renewal reminder(s).`);
  }
  return sent;
}

module.exports = { sendRenewalReminders };
