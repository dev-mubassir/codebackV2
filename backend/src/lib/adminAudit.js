/**
 * The admin audit trail (admin_audit_logs).
 *
 * Every admin login attempt and every admin mutation writes one row here:
 * who, what, to which target, why (the admin's written reason), the state
 * before and after, and from where.
 *
 * NEVER THROWS. By the time most callers audit, the action has already
 * happened (a Meta call, a committed update); failing the request at that
 * point would report an error for something that succeeded. A failed audit
 * write is logged loudly instead. Where an action and its audit row can share
 * a transaction, callers use buildAuditRow() inside prisma.$transaction so
 * the two commit or roll back together.
 *
 * NO DM CONTENT, NO SECRETS. before/after carry ids, flags and statuses only;
 * callers must never pass message text, tokens or password material.
 */

const prisma = require('./prisma');

const MAX_UA = 300;
const MAX_REASON = 500;

function clientMeta(req) {
  const ua = req && typeof req.get === 'function' ? req.get('user-agent') : null;
  return {
    ip: (req && req.ip) || null,
    userAgent: ua ? String(ua).slice(0, MAX_UA) : null,
  };
}

/** The data for one audit row. Use inside a transaction: tx.adminAuditLog.create({ data: buildAuditRow(...) }). */
function buildAuditRow(req, { action, adminId = null, targetType = null, targetId = null, reason = null, before = null, after = null }) {
  return {
    adminId: adminId || (req && req.admin ? req.admin.id : null),
    action,
    targetType,
    targetId: targetId == null ? null : String(targetId),
    reason: reason ? String(reason).slice(0, MAX_REASON) : null,
    before: before ?? undefined,
    after: after ?? undefined,
    ...clientMeta(req),
  };
}

async function recordAdminAudit(req, entry) {
  try {
    await prisma.adminAuditLog.create({ data: buildAuditRow(req, entry) });
    return true;
  } catch (err) {
    console.error(`[AdminAudit] FAILED to record ${entry && entry.action}:`, err.message);
    return false;
  }
}

module.exports = { recordAdminAudit, buildAuditRow };
