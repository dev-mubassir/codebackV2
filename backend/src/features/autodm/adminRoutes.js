/**
 * /api/admin/autodm — Auto DM rollout control for admins.
 *
 * Mounted INSIDE routes/admin.js after requireAdmin, adminOriginGuard and
 * trackAdminActivity, so the existing admin session, role check and CSRF
 * origin guard apply; a non-admin gets the admin router's usual 404.
 *
 *   GET    /                  mode, kill switch, grants with per-user counts
 *   PUT    /mode              { mode, reason, confirm? }   (step-up; EVERYONE needs confirm: 'EVERYONE')
 *   POST   /grants            { email, note }              (the user must exist)
 *   DELETE /grants/:userId    { reason }
 *
 * Every change is written to the admin audit log. No tokens, no message or
 * comment content — ids, emails, counts only.
 */

const express = require('express');
const prisma = require('../../lib/prisma');
const { recordAdminAudit } = require('../../lib/adminAudit');
const { requireStepUp } = require('../../middleware/adminAuth');
const { validate, z } = require('../../middleware/validate');
const config = require('./config');
const log = require('./log');
const { MODES, MODE_KEY, getRolloutMode, setRolloutMode } = require('./access');

const router = express.Router();

const reason = z.string().trim().min(3, 'give a reason (3 to 500 characters)').max(500, 'give a reason (3 to 500 characters)');

const modeBody = z
  .object({ mode: z.enum(MODES), reason, confirm: z.string().optional() })
  .strict();
const grantBody = z
  .object({
    email: z.string().trim().toLowerCase().min(3).max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'enter a valid email address'),
    note: reason,
  })
  .strict();
const revokeParams = z.object({ userId: z.string().uuid('must be a valid id') }).strict();
const revokeBody = z.object({ reason }).strict();

const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    log.error(`admin ${req.method} ${req.path} failed (${err && err.code ? err.code : 'error'})`);
    if (!res.headersSent) res.status(500).json({ error: "Couldn't complete that. Try again." });
  });

async function grantCounts(userIds) {
  const out = new Map(userIds.map((id) => [id, { automations: 0, dmsSent: 0, failures: 0 }]));
  if (userIds.length === 0) return out;
  const [automations, sent, failed] = await Promise.all([
    prisma.autoDmAutomation.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true } }),
    prisma.autoDmRun.groupBy({ by: ['userId'], where: { userId: { in: userIds }, openerSentAt: { not: null } }, _count: { _all: true } }),
    prisma.autoDmRun.groupBy({ by: ['userId'], where: { userId: { in: userIds }, status: 'FAILED' }, _count: { _all: true } }),
  ]);
  for (const g of automations) out.get(g.userId).automations = g._count._all;
  for (const g of sent) out.get(g.userId).dmsSent = g._count._all;
  for (const g of failed) out.get(g.userId).failures = g._count._all;
  return out;
}

// GET /api/admin/autodm
router.get(
  '/',
  wrap(async (req, res) => {
    const grants = await prisma.autoDmAccess.findMany({
      orderBy: { createdAt: 'desc' },
      select: { userId: true, note: true, createdAt: true, grantedByAdminId: true, user: { select: { email: true, name: true } } },
    });
    const counts = await grantCounts(grants.map((g) => g.userId));
    const setting = await prisma.appSetting.findUnique({ where: { key: MODE_KEY }, select: { updatedAt: true, updatedBy: true } });
    res.json({
      killSwitchOn: config.isEnabled(),
      mode: await getRolloutMode(),
      modes: MODES,
      modeUpdatedAt: setting ? setting.updatedAt : null,
      pollMode: config.pollMode(),
      envAllowlistCount: String(process.env.AUTODM_SCOPE_ALLOWLIST || '').split(',').filter((s) => s.trim()).length,
      grants: grants.map((g) => ({
        userId: g.userId,
        email: g.user.email,
        name: g.user.name,
        note: g.note,
        grantedAt: g.createdAt,
        grantedByAdminId: g.grantedByAdminId,
        counts: counts.get(g.userId),
      })),
    });
  })
);

// PUT /api/admin/autodm/mode
router.put(
  '/mode',
  requireStepUp,
  validate({ body: modeBody }),
  wrap(async (req, res) => {
    const { mode } = req.body;
    if (mode === 'EVERYONE' && req.body.confirm !== 'EVERYONE') {
      return res.status(400).json({ error: 'Confirm turning Auto DM on for everyone.', code: 'CONFIRM_REQUIRED' });
    }
    const { before, after } = await setRolloutMode(mode, req.admin.id);
    await recordAdminAudit(req, {
      action: 'AUTODM_ROLLOUT_MODE',
      targetType: 'SETTING',
      targetId: MODE_KEY,
      reason: req.body.reason,
      before: { value: before },
      after: { value: after },
    });
    log.info(`rollout mode ${before} -> ${after} by admin ${req.admin.id}`);
    res.json({ mode: after });
  })
);

// POST /api/admin/autodm/grants
router.post(
  '/grants',
  validate({ body: grantBody }),
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email }, select: { id: true, email: true } });
    if (!user) return res.status(404).json({ error: 'No Siffty user has that email. They need to sign up first.', code: 'NO_USER' });

    const existing = await prisma.autoDmAccess.findUnique({ where: { userId: user.id }, select: { id: true } });
    await prisma.autoDmAccess.upsert({
      where: { userId: user.id },
      create: { userId: user.id, grantedByAdminId: req.admin.id, note: req.body.note },
      update: { grantedByAdminId: req.admin.id, note: req.body.note },
    });
    await recordAdminAudit(req, {
      action: 'AUTODM_ACCESS_GRANT',
      targetType: 'USER',
      targetId: user.id,
      reason: req.body.note,
      before: { granted: Boolean(existing) },
      after: { granted: true },
    });
    log.info(`access granted to user ${user.id} by admin ${req.admin.id}`);
    res.status(existing ? 200 : 201).json({ userId: user.id, email: user.email, granted: true });
  })
);

// DELETE /api/admin/autodm/grants/:userId — automations become inert; no data is deleted.
router.delete(
  '/grants/:userId',
  validate({ params: revokeParams, body: revokeBody }),
  wrap(async (req, res) => {
    const removed = await prisma.autoDmAccess.deleteMany({ where: { userId: req.params.userId } });
    if (removed.count === 0) return res.status(404).json({ error: 'That user has no Auto DM grant.' });
    await recordAdminAudit(req, {
      action: 'AUTODM_ACCESS_REVOKE',
      targetType: 'USER',
      targetId: req.params.userId,
      reason: req.body.reason,
      before: { granted: true },
      after: { granted: false },
    });
    log.info(`access revoked from user ${req.params.userId} by admin ${req.admin.id}`);
    res.json({ userId: req.params.userId, granted: false });
  })
);

module.exports = router;
