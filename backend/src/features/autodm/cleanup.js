/**
 * Auto DM retention (the `autodm_cleanup` job, every 6 hours).
 *
 *   1. Runs older than 90 days are deleted (the published retention).
 *   2. Images uploaded but never attached to a saved automation are deleted
 *      after 24 hours.
 *   3. Every Auto DM row of a DISCONNECTED account is deleted. A soft
 *      disconnect keeps the instagram_accounts row (history), so no cascade
 *      fires; running every 6 hours keeps the published promise of "within
 *      24 hours of disconnecting". Purge, the Meta data-deletion callback and
 *      account deletion cascade immediately.
 *
 * Runs regardless of AUTODM_ENABLED: retention is a privacy obligation, and
 * with the feature off these are a few no-op DELETEs. Counts only in logs.
 */

const prisma = require('../../lib/prisma');
const log = require('./log');

const RUN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const ORPHAN_IMAGE_MS = 24 * 60 * 60 * 1000;

async function runCleanup({ now = Date.now() } = {}) {
  const oldRuns = await prisma.autoDmRun.deleteMany({
    where: { createdAt: { lt: new Date(now - RUN_RETENTION_MS) } },
  });

  const orphanImages = await prisma.autoDmImage.deleteMany({
    where: { automationId: null, createdAt: { lt: new Date(now - ORPHAN_IMAGE_MS) } },
  });

  const disconnected = await prisma.instagramAccount.findMany({
    where: {
      connectionStatus: 'DISCONNECTED',
      OR: [
        { autoDmAutomations: { some: {} } },
        { autoDmRuns: { some: {} } },
        { autoDmState: { isNot: null } },
      ],
    },
    select: { id: true },
  });
  const ids = disconnected.map((a) => a.id);

  let disconnectedRows = 0;
  if (ids.length) {
    // Automations cascade to their runs and images.
    const [automations, runs, states] = await prisma.$transaction([
      prisma.autoDmAutomation.deleteMany({ where: { instagramAccountId: { in: ids } } }),
      prisma.autoDmRun.deleteMany({ where: { instagramAccountId: { in: ids } } }),
      prisma.autoDmAccountState.deleteMany({ where: { instagramAccountId: { in: ids } } }),
    ]);
    disconnectedRows = automations.count + runs.count + states.count;
  }

  // 4. The account moved to another workspace (the reconnect re-points the
  //    same instagram_accounts row at the new owner): the previous owner's
  //    Auto DM rows are already inert (every query is owner-scoped) and are
  //    deleted here, like a disconnect.
  const [movedAutomations, movedRuns, movedStates] = await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "autodm_automations" a USING "instagram_accounts" i
                        WHERE a."instagram_account_id" = i."id" AND a."user_id" <> i."user_id"`,
    prisma.$executeRaw`DELETE FROM "autodm_runs" r USING "instagram_accounts" i
                        WHERE r."instagram_account_id" = i."id" AND r."user_id" <> i."user_id"`,
    prisma.$executeRaw`DELETE FROM "autodm_account_states" s USING "instagram_accounts" i
                        WHERE s."instagram_account_id" = i."id" AND s."user_id" <> i."user_id"`,
  ]);

  const result = {
    oldRuns: oldRuns.count,
    orphanImages: orphanImages.count,
    disconnectedAccounts: ids.length,
    disconnectedRows,
    movedRows: movedAutomations + movedRuns + movedStates,
  };
  if (result.oldRuns || result.orphanImages || result.disconnectedAccounts || result.movedRows) {
    log.info(`cleanup: ${JSON.stringify(result)}`);
  }
  return result;
}

module.exports = { runCleanup, RUN_RETENTION_MS, ORPHAN_IMAGE_MS };
