/**
 * Deleting a Siffty user — ONE implementation for every path (Gate 5):
 *
 *   DELETE /auth/account          the user deletes themselves
 *   POST /data-deletion/instagram Meta's deletion callback, when the last
 *                                 connected Instagram account goes
 *   DELETE /api/admin/users/:id   an admin, with step-up + reason + audit
 *
 * What it does, in order:
 *   1. deletes the users row. Every owned table cascades from it: Instagram
 *      accounts, contacts, conversations, messages, analyses, summaries,
 *      brand deals, notifications, webhook logs, auth tokens/identities,
 *      business profile, preferences, entitlement.
 *   2. deletes the tenant's ai_call_logs rows (metadata only, but tied to
 *      the tenant id and not a relation, so no cascade reaches them).
 *   3. ends EVERY session of that user (the Postgres store, all devices) and
 *      disconnects their sockets — before this, DELETE /auth/account ended
 *      only the caller's own session.
 *
 * Deliberately KEPT, as before and as documented in PRIVACY_NOTES.md:
 * orders / payment_attempts / refunds / credit_ledger (financial records),
 * instagram_identities (the pseudonymised trial-abuse ledger), and
 * admin_audit_logs (the audit trail — rows reference the user id only).
 *
 * Returns { deleted: boolean, instagramAccounts: number }. A user that is
 * already gone returns { deleted: false } rather than throwing.
 */

const prisma = require('../lib/prisma');
const { destroyUserSessions } = require('../lib/session');
const { disconnectUserSockets } = require('../lib/socket');

async function deleteUserAccount(userId) {
  if (!userId) return { deleted: false, instagramAccounts: 0 };

  const instagramAccounts = await prisma.instagramAccount.count({ where: { userId } });
  const removed = await prisma.user.delete({ where: { id: userId } }).catch((err) => {
    if (err.code === 'P2025') return null; // already gone
    throw err;
  });
  if (!removed) return { deleted: false, instagramAccounts: 0 };

  await prisma.aiCallLog.deleteMany({ where: { tenantId: userId } }).catch((err) =>
    console.error('[AccountDeletion] Could not remove AI call logs:', err.message)
  );
  await destroyUserSessions(userId).catch((err) =>
    console.error('[AccountDeletion] Could not end sessions:', err.message)
  );
  disconnectUserSockets(userId);

  return { deleted: true, instagramAccounts };
}

module.exports = { deleteUserAccount };
