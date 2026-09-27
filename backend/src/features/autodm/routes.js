/**
 * /api/autodm — the customer API for Auto DM.
 *
 *   GET    /status                      always answers (the sidebar reads it):
 *                                        {enabled:true, available:true} with
 *                                        access, otherwise exactly {enabled:false}
 *   — everything below: 404 AUTODM_DISABLED unless hasAutoDmAccess(caller)
 *     (access.js: kill switch + admin rollout mode + grant) —
 *   GET    /accounts                    connected accounts + comments-scope state
 *   GET    /accounts/:accountId/media   recent posts/reels (post picker)
 *   GET    /automations[?accountId=]    list with run counts
 *   POST   /automations                 create (Save & activate)
 *   GET    /automations/:id
 *   PUT    /automations/:id
 *   PATCH  /automations/:id/status      { status: active | paused }
 *   DELETE /automations/:id
 *   GET    /automations/:id/runs        last 50 runs (the run log)
 *   POST   /images                      raw JPG/PNG body, ≤2 MB
 *
 * Tenant isolation: every query filters by req.userId (and the account ids
 * requireWorkspace resolved). Another tenant's id is a plain 404 — never 403,
 * which would confirm it exists. Graph API errors are never passed through;
 * the client gets a fixed, safe message.
 */

const crypto = require('crypto');
const express = require('express');
const prisma = require('../../lib/prisma');
const { requireAuth } = require('../../middleware/auth');
const { requireWorkspace } = require('../../middleware/authorize');
const { createRateLimiter } = require('../../lib/rateLimit');
const { validate } = require('../../middleware/validate');
const { readAccountToken } = require('../../lib/crypto');
const { handleMetaError } = require('../../lib/tokenHealth');
const { isTokenInvalidError } = require('../../lib/instagram');
const graph = require('./graph');
const { hasAutoDmAccess } = require('./access');
const log = require('./log');
const v = require('./validation');
const images = require('./images');

const router = express.Router();

// Per user (per IP when logged out). Generous for a UI that refreshes a run
// log, tight enough that a script cannot hammer the Graph proxy (media list).
const autodmLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many Auto DM requests. Wait a minute and try again.',
  keyBy: (req) => (req.session && req.session.userId ? `u:${req.session.userId}` : null),
});

router.use(autodmLimiter);
router.use(requireAuth);

// GET /api/autodm/status — a user without access learns nothing beyond "off".
router.get('/status', async (req, res) => {
  let access = false;
  try {
    access = await hasAutoDmAccess(req.user);
  } catch {
    access = false;
  }
  res.json(access ? { enabled: true, available: true } : { enabled: false });
});

// Everything below: this user has access (404, not 403 — nothing to discover).
async function requireAutoDm(req, res, next) {
  let access = false;
  try {
    access = await hasAutoDmAccess(req.user);
  } catch {
    access = false;
  }
  if (!access) return res.status(404).json({ error: 'Auto DM is not available.', code: 'AUTODM_DISABLED' });
  return next();
}

router.use(requireAutoDm);
router.use(requireWorkspace);

/** Express 4 does not catch async errors; answer a safe 500 instead. */
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    log.error(`${req.method} ${req.baseUrl}${req.route ? req.route.path : ''} failed (${err && err.code ? err.code : 'error'})`);
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong with Auto DM. Try again." });
  });

const notFound = (res) => res.status(404).json({ error: 'That automation no longer exists.' });

// ---------------------------------------------------------------------------
// Serialisers — explicit fields only
// ---------------------------------------------------------------------------

const AUTOMATION_FIELDS = {
  id: true,
  instagramAccountId: true,
  name: true,
  status: true,
  postScope: true,
  mediaIds: true,
  triggerType: true,
  keywords: true,
  excludeKeywords: true,
  publicReplyEnabled: true,
  publicReplies: true,
  openerText: true,
  openerButtonLabel: true,
  fallbackKeyword: true,
  mainText: true,
  linkUrl: true,
  linkLabel: true,
  followGateEnabled: true,
  followPromptText: true,
  followButtonLabel: true,
  followFailText: true,
  createdAt: true,
  updatedAt: true,
  image: { select: { id: true, contentType: true, byteSize: true } },
};

function serializeAutomation(a, counts) {
  const { image, ...rest } = a;
  return {
    ...rest,
    imageId: image ? image.id : null,
    image: image || null,
    ...(counts ? { counts } : {}),
  };
}

const RUN_FIELDS = {
  id: true,
  commenterUsername: true,
  commentText: true,
  status: true,
  source: true,
  followChecks: true,
  attempts: true,
  lastError: true,
  createdAt: true,
  publicReplyAt: true,
  openerSentAt: true,
  mainImageSentAt: true,
  deliveredAt: true,
};

const emptyCounts = () => ({ matched: 0, dmsSent: 0, delivered: 0, waitingFollow: 0, failed: 0 });

async function countsFor(userId, automationIds) {
  const out = new Map(automationIds.map((id) => [id, emptyCounts()]));
  if (automationIds.length === 0) return out;
  const [byStatus, sent] = await Promise.all([
    prisma.autoDmRun.groupBy({
      by: ['automationId', 'status'],
      where: { userId, automationId: { in: automationIds } },
      _count: { _all: true },
    }),
    prisma.autoDmRun.groupBy({
      by: ['automationId'],
      where: { userId, automationId: { in: automationIds }, openerSentAt: { not: null } },
      _count: { _all: true },
    }),
  ]);
  for (const g of byStatus) {
    const c = out.get(g.automationId);
    if (!c) continue;
    c.matched += g._count._all;
    if (g.status === 'DELIVERED') c.delivered += g._count._all;
    if (g.status === 'AWAITING_FOLLOW') c.waitingFollow += g._count._all;
    if (g.status === 'FAILED') c.failed += g._count._all;
  }
  for (const g of sent) {
    const c = out.get(g.automationId);
    if (c) c.dmsSent = g._count._all;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Accounts and media
// ---------------------------------------------------------------------------

router.get(
  '/accounts',
  wrap(async (req, res) => {
    const accounts = await prisma.instagramAccount.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        igUsername: true,
        igProfilePic: true,
        connectionStatus: true,
        tokenStatus: true,
        autoDmState: { select: { commentsGranted: true, commentsSubscribedAt: true, userId: true } },
      },
    });
    res.json(
      accounts.map(({ autoDmState, ...a }) => {
        const state = autoDmState && autoDmState.userId === req.userId ? autoDmState : null;
        return {
          ...a,
          commentsGranted: Boolean(state && state.commentsGranted),
          commentsSubscribed: Boolean(state && state.commentsSubscribedAt),
          ready: a.connectionStatus === 'CONNECTED' && Boolean(state && state.commentsGranted),
        };
      })
    );
  })
);

const httpsOrNull = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

router.get(
  '/accounts/:accountId/media',
  validate({ params: v.accountParams }),
  wrap(async (req, res) => {
    const account = await prisma.instagramAccount.findFirst({
      where: { id: req.params.accountId, userId: req.userId, connectionStatus: 'CONNECTED' },
      select: { id: true, accessToken: true, tokenCiphertext: true, tokenIv: true, tokenAuthTag: true, tokenKeyVersion: true },
    });
    if (!account) return res.status(404).json({ error: 'That Instagram account is not connected.' });

    let media;
    try {
      media = await graph.listMedia(readAccountToken(account), { limit: 24 });
    } catch (err) {
      if (isTokenInvalidError(err)) {
        await handleMetaError(err, account.id).catch(() => {});
        return res.status(409).json({ error: 'Reconnect Instagram to load your posts.', code: 'RECONNECT_REQUIRED' });
      }
      log.warn(`media list failed for account ${account.id} (${graph.safeErrorCode(err)})`);
      return res.status(502).json({ error: "Couldn't load your posts from Instagram. Try again." });
    }

    res.json(
      media
        .filter((m) => m && m.id)
        .map((m) => ({
          id: String(m.id),
          caption: typeof m.caption === 'string' ? m.caption.slice(0, 200) : '',
          mediaType: m.media_type || null,
          productType: m.media_product_type || null,
          thumbnailUrl: httpsOrNull(m.thumbnail_url) || (m.media_type === 'VIDEO' ? null : httpsOrNull(m.media_url)),
          permalink: httpsOrNull(m.permalink),
          timestamp: m.timestamp || null,
        }))
    );
  })
);

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

router.get(
  '/automations',
  validate({ query: v.listQuery }),
  wrap(async (req, res) => {
    const accountIds = req.query.accountId
      ? req.ownedAccountIds.filter((id) => id === req.query.accountId)
      : req.ownedAccountIds;
    const automations = await prisma.autoDmAutomation.findMany({
      where: { userId: req.userId, instagramAccountId: { in: accountIds } },
      orderBy: { createdAt: 'desc' },
      select: AUTOMATION_FIELDS,
    });
    const counts = await countsFor(req.userId, automations.map((a) => a.id));
    res.json(automations.map((a) => serializeAutomation(a, counts.get(a.id))));
  })
);

async function ownedAutomation(req, id) {
  return prisma.autoDmAutomation.findFirst({
    where: { id, userId: req.userId, instagramAccountId: { in: req.ownedAccountIds } },
    select: AUTOMATION_FIELDS,
  });
}

/** The account must be the caller's, connected, and hold the comments scope. */
async function readyAccount(req, accountId) {
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId: req.userId },
    select: { id: true, connectionStatus: true, autoDmState: { select: { commentsGranted: true, userId: true } } },
  });
  if (!account) return { error: [404, { error: 'That Instagram account no longer exists.' }] };
  const state = account.autoDmState;
  if (account.connectionStatus !== 'CONNECTED' || !state || state.userId !== req.userId || !state.commentsGranted) {
    return {
      error: [409, { error: 'Reconnect Instagram to enable Auto DM for this account.', code: 'RECONNECT_REQUIRED' }],
    };
  }
  return { account };
}

function automationData(b) {
  return {
    name: b.name,
    status: b.status,
    postScope: b.postScope,
    mediaIds: b.postScope === 'SPECIFIC' ? Array.from(new Set(b.mediaIds)) : [],
    triggerType: b.triggerType,
    keywords: b.triggerType === 'KEYWORDS' ? b.keywords : [],
    excludeKeywords: b.excludeKeywords,
    publicReplyEnabled: b.publicReplyEnabled,
    publicReplies: b.publicReplyEnabled ? b.publicReplies : [],
    openerText: b.openerText,
    openerButtonLabel: b.openerButtonLabel,
    fallbackKeyword: b.fallbackKeyword,
    mainText: b.mainText,
    linkUrl: b.linkUrl,
    linkLabel: b.linkUrl ? b.linkLabel : null,
    followGateEnabled: b.followGateEnabled,
    followPromptText: b.followGateEnabled ? b.followPromptText : null,
    followButtonLabel: b.followGateEnabled ? b.followButtonLabel : null,
    followFailText: b.followGateEnabled ? b.followFailText : null,
  };
}

/** An uploaded image of this user, not yet attached (or attached to `automationId`). */
async function usableImage(req, imageId, automationId = null) {
  if (!imageId) return null;
  return prisma.autoDmImage.findFirst({
    where: {
      id: imageId,
      userId: req.userId,
      OR: [{ automationId: null }, ...(automationId ? [{ automationId }] : [])],
    },
    select: { id: true, automationId: true },
  });
}

router.post(
  '/automations',
  validate({ body: v.automationBody }),
  wrap(async (req, res) => {
    const b = req.body;
    const { error } = await readyAccount(req, b.instagramAccountId);
    if (error) return res.status(error[0]).json(error[1]);

    const image = await usableImage(req, b.imageId);
    if (b.imageId && !image) return res.status(400).json({ error: 'imageId: that image is no longer available. Upload it again.' });

    const id = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.autoDmAutomation.create({
        data: { id, userId: req.userId, instagramAccountId: b.instagramAccountId, ...automationData(b) },
      });
      if (image) await tx.autoDmImage.update({ where: { id: image.id }, data: { automationId: id } });
    });

    log.info(`automation ${id} created (${b.status})`);
    const saved = await ownedAutomation(req, id);
    res.status(201).json(serializeAutomation(saved, emptyCounts()));
  })
);

router.get(
  '/automations/:id',
  validate({ params: v.idParams }),
  wrap(async (req, res) => {
    const a = await ownedAutomation(req, req.params.id);
    if (!a) return notFound(res);
    const counts = await countsFor(req.userId, [a.id]);
    res.json(serializeAutomation(a, counts.get(a.id)));
  })
);

router.put(
  '/automations/:id',
  validate({ params: v.idParams, body: v.automationBody }),
  wrap(async (req, res) => {
    const existing = await ownedAutomation(req, req.params.id);
    if (!existing) return notFound(res);
    const b = req.body;
    if (b.instagramAccountId !== existing.instagramAccountId) {
      return res.status(400).json({ error: 'instagramAccountId: an automation cannot move to another account.' });
    }
    const { error } = await readyAccount(req, b.instagramAccountId);
    if (error) return res.status(error[0]).json(error[1]);

    const currentImageId = existing.image ? existing.image.id : null;
    const image = await usableImage(req, b.imageId, existing.id);
    if (b.imageId && !image) return res.status(400).json({ error: 'imageId: that image is no longer available. Upload it again.' });

    await prisma.$transaction(async (tx) => {
      await tx.autoDmAutomation.update({ where: { id: existing.id }, data: automationData(b) });
      if (currentImageId && currentImageId !== b.imageId) {
        await tx.autoDmImage.deleteMany({ where: { id: currentImageId, userId: req.userId } });
      }
      if (image && image.automationId !== existing.id) {
        await tx.autoDmImage.update({ where: { id: image.id }, data: { automationId: existing.id } });
      }
    });

    const saved = await ownedAutomation(req, existing.id);
    const counts = await countsFor(req.userId, [saved.id]);
    res.json(serializeAutomation(saved, counts.get(saved.id)));
  })
);

router.patch(
  '/automations/:id/status',
  validate({ params: v.idParams, body: v.statusBody }),
  wrap(async (req, res) => {
    const result = await prisma.autoDmAutomation.updateMany({
      where: { id: req.params.id, userId: req.userId, instagramAccountId: { in: req.ownedAccountIds } },
      data: { status: req.body.status },
    });
    if (result.count === 0) return notFound(res);
    log.info(`automation ${req.params.id} ${req.body.status}`);
    res.json({ id: req.params.id, status: req.body.status });
  })
);

router.delete(
  '/automations/:id',
  validate({ params: v.idParams }),
  wrap(async (req, res) => {
    // Cascades to its runs and its image (the public image URL then 404s).
    const result = await prisma.autoDmAutomation.deleteMany({
      where: { id: req.params.id, userId: req.userId, instagramAccountId: { in: req.ownedAccountIds } },
    });
    if (result.count === 0) return notFound(res);
    log.info(`automation ${req.params.id} deleted`);
    res.json({ message: 'Automation deleted.' });
  })
);

router.get(
  '/automations/:id/runs',
  validate({ params: v.idParams }),
  wrap(async (req, res) => {
    const a = await prisma.autoDmAutomation.findFirst({
      where: { id: req.params.id, userId: req.userId, instagramAccountId: { in: req.ownedAccountIds } },
      select: { id: true },
    });
    if (!a) return notFound(res);
    const runs = await prisma.autoDmRun.findMany({
      where: { automationId: a.id, userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: RUN_FIELDS,
    });
    res.json(runs);
  })
);

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

router.post('/images', images.rawImageBody, wrap(images.uploadImage));

module.exports = router;
module.exports.requireAutoDm = requireAutoDm;
