/**
 * Operational alerts to the admins (every admin_users address), through the
 * ADMIN email bucket (lib/email/quota.js): routine tier, so they can never
 * spend the 3 sends held back for lockout alerts, and never touch customer
 * mail. Used by the token-refresh job (Gate 3B) and the alert cron (Gate 7).
 *
 * Never throws. The facts passed in must be counts, ids, handles and codes —
 * never message text, tokens or secrets.
 */

const prisma = require('./prisma');
// Bound as `mailer`, never `email` — see routes/auth.js.
const mailer = require('./email');

async function sendAdminOpsAlert({ title, lead, facts = [] }) {
  let admins = [];
  try {
    admins = await prisma.adminUser.findMany({ select: { email: true } });
  } catch (err) {
    console.error('[AdminAlert] Could not load admin addresses:', err.message);
  }
  if (admins.length === 0) {
    console.error(`[AdminAlert] No admin to tell: ${title}`);
    return 0;
  }
  let sent = 0;
  for (const { email } of admins) {
    try {
      await mailer.sendAdminOpsAlert(email, { title, lead, facts });
      sent += 1;
    } catch (err) {
      console.error(`[AdminAlert] "${title}" could not be sent:`, err.message);
    }
  }
  return sent;
}

module.exports = { sendAdminOpsAlert };
