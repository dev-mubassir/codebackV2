/**
 * The durable webhook inbox — the "zero missed DMs" guarantee.
 *
 *   1. store()     the signed raw body goes into webhook_deliveries BEFORE Meta
 *                  gets its 200. If that write fails the route answers 5xx and
 *                  Meta retries. Meta is never told "received" for a payload
 *                  we do not hold.
 *   2. dispatch()  after the 200: hand the delivery to the webhook queue
 *                  (BullMQ with Redis, in-process without). If the queue is
 *                  unavailable or slow (Redis down), process it right here
 *                  instead, so live DMs keep flowing through a Redis outage.
 *   3. process()   claim the row, run the Meta processor, stamp processed_at
 *                  and clear the payload. Any failure leaves it unprocessed.
 *   4. recover()   the sweep: anything not processed 5 minutes after arrival
 *                  (crash mid-processing, redeploy, lost queue job, AI or DB
 *                  blip) is claimed and processed again.
 *
 * Re-processing is always safe: Message.igMessageId is unique, so a delivery
 * processed twice saves each DM once.
 */

const crypto = require('crypto');
const prisma = require('../lib/prisma');

const RECOVER_AFTER_MS = 5 * 60 * 1000;   // unprocessed this long -> the sweep takes it
const CLAIM_LEASE_MS = 5 * 60 * 1000;     // a claim older than this is considered abandoned
const MAX_ATTEMPTS = 20;                  // then it waits for a human (admin alert shows the backlog)
const RECOVER_BATCH = 100;
const DISPATCH_TIMEOUT_MS = 2000;

const hashBody = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/**
 * Save a verified delivery. Resolves { id, duplicate }.
 * REJECTS if the database write fails — the caller must answer 5xx.
 */
async function store(rawBody, { provider = 'meta' } = {}) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''));
  const deliveryHash = hashBody(raw);
  try {
    const row = await prisma.webhookDelivery.create({
      data: { provider, deliveryHash, payload: raw.toString('utf8') },
      select: { id: true },
    });
    return { id: row.id, duplicate: false };
  } catch (err) {
    if (err.code === 'P2002') {
      // A Meta retry of a body we already hold. It is either processed, or the
      // queue/sweep will get to it — nothing to do but acknowledge.
      const existing = await prisma.webhookDelivery.findUnique({
        where: { provider_deliveryHash: { provider, deliveryHash } },
        select: { id: true },
      });
      return { id: existing ? existing.id : null, duplicate: true };
    }
    throw err;
  }
}

/**
 * Claim, process, mark done. Resolves 'processed' | 'already_processed' |
 * 'claimed_elsewhere' | 'no_payload'. Rejects if processing failed (the row
 * stays unprocessed, with the error recorded, for a retry).
 */
async function processDelivery(id, { force = false } = {}) {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - CLAIM_LEASE_MS);
  // The claim: only one worker at a time, unless a previous claim is stale
  // (its worker died). `force` is the sweep, which only picks stale rows anyway.
  const claimed = await prisma.webhookDelivery.updateMany({
    where: {
      id,
      processedAt: null,
      payload: { not: null },
      ...(force ? {} : { OR: [{ claimedAt: null }, { claimedAt: { lt: leaseCutoff } }] }),
    },
    data: { claimedAt: now, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    const row = await prisma.webhookDelivery.findUnique({ where: { id }, select: { processedAt: true, payload: true } });
    if (!row || row.processedAt) return 'already_processed';
    if (row.payload === null) return 'no_payload';
    return 'claimed_elsewhere';
  }

  const row = await prisma.webhookDelivery.findUnique({ where: { id }, select: { payload: true } });
  let body;
  try {
    body = JSON.parse(row.payload);
  } catch {
    // Signed but not JSON — nothing can ever process it. Close it out.
    await prisma.webhookDelivery.update({
      where: { id },
      data: { processedAt: new Date(), payload: null, lastError: 'unparseable payload' },
    });
    return 'processed';
  }

  const { processEntry } = require('./metaWebhookProcessor');
  try {
    for (const entry of body.entry || []) {
      await processEntry(entry, body);
    }
  } catch (err) {
    await prisma.webhookDelivery
      .update({ where: { id }, data: { claimedAt: null, lastError: String(err.message || err).split('\n')[0].slice(0, 300) } })
      .catch(() => {});
    throw err;
  }

  // Done: the payload (customer message text) is not kept once it is in the
  // inbox — the row stays only as the idempotency key until housekeeping.
  await prisma.webhookDelivery.update({
    where: { id },
    data: { processedAt: new Date(), payload: null, lastError: null },
  });
  return 'processed';
}

/**
 * After the 200: queue the delivery, or process it here if the queue cannot
 * take it within DISPATCH_TIMEOUT_MS. Never rejects.
 */
async function dispatch(id) {
  if (!id) return;
  // Idempotent; registers the webhook worker if this process has not yet
  // (src/index.js does it at boot — this covers any other entry point).
  require('../jobs').startWorkers();
  const { getJobSystem } = require('../lib/queue');
  const system = getJobSystem(WEBHOOK_QUEUE);
  let timer;
  try {
    await Promise.race([
      system.add('webhook.process', { deliveryId: id }, { jobId: `delivery-${id}`, attempts: 5, backoffMs: 2000 }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('queue did not accept the job in time')), DISPATCH_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    console.warn(`[Webhook] Queue unavailable (${err.message}); processing delivery ${id} in-process.`);
    await processDelivery(id).catch((e) =>
      console.error(`[Webhook] In-process delivery ${id} failed; the recovery sweep will retry:`, e.message)
    );
  } finally {
    clearTimeout(timer);
  }
}

/** The recovery sweep. Returns counts only. */
async function recoverUnprocessedDeliveries({ now = Date.now() } = {}) {
  const due = await prisma.webhookDelivery.findMany({
    where: {
      processedAt: null,
      payload: { not: null },
      receivedAt: { lt: new Date(now - RECOVER_AFTER_MS) },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now - CLAIM_LEASE_MS) } }],
    },
    orderBy: { receivedAt: 'asc' },
    take: RECOVER_BATCH,
    select: { id: true },
  });

  let recovered = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      if ((await processDelivery(id)) === 'processed') recovered += 1;
    } catch {
      failed += 1;
    }
  }
  if (recovered || failed) console.log(`[Webhook] Recovery sweep: ${recovered} recovered, ${failed} still failing.`);
  return { recovered, failed };
}

/** For the admin health page and the backlog alert. */
async function backlogStats({ now = Date.now(), olderThanMs = 10 * 60 * 1000 } = {}) {
  const base = { processedAt: null, payload: { not: null } };
  const [unprocessed, stale, oldest] = await Promise.all([
    prisma.webhookDelivery.count({ where: base }),
    prisma.webhookDelivery.count({ where: { ...base, receivedAt: { lt: new Date(now - olderThanMs) } } }),
    prisma.webhookDelivery.findFirst({ where: base, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } }),
  ]);
  return { unprocessed, olderThan10Min: stale, oldestReceivedAt: oldest ? oldest.receivedAt : null };
}

const WEBHOOK_QUEUE = 'webhook-processing';

module.exports = {
  store,
  dispatch,
  processDelivery,
  recoverUnprocessedDeliveries,
  backlogStats,
  WEBHOOK_QUEUE,
  RECOVER_AFTER_MS,
  MAX_ATTEMPTS,
};
