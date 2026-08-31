/**
 * Idempotency ledger for payment-provider webhooks (Cashfree Subscriptions +
 * Cashfree PG), backed by the ProcessedWebhookEvent table from Phase 1b.
 *
 * Unlike the Instagram webhook — which dedupes via the uniqueness of the
 * domain row it's writing (Message.igMessageId) — these events don't map
 * onto an existing unique row, so this ledger is the only guard. A double-
 * processed webhook here could double-activate a subscription or double-
 * credit an add-on purchase, so the claim must be atomic.
 */

const prisma = require('./prisma');

/**
 * Attempt to claim a webhook event for processing. Returns true the first
 * time a given (provider, eventId) pair is seen; false on every repeat.
 * Atomic via the table's unique constraint — a create() that fails with
 * P2002 means another request already claimed it, not a race to detect
 * and handle separately.
 */
async function claimWebhookEvent(provider, eventId) {
  try {
    await prisma.processedWebhookEvent.create({ data: { provider, eventId } });
    return true;
  } catch (err) {
    if (err.code === 'P2002') return false;
    throw err;
  }
}

/**
 * Release a claim after processing failed with a genuine/transient error.
 * Without this, claiming the event up front (needed for atomicity — see
 * claimWebhookEvent) would permanently burn the idempotency slot on a
 * failure that's supposed to be retried: the real retry delivery would
 * then be wrongly treated as "already processed" and silently skipped,
 * defeating the point of returning 500 in the first place. Not called for
 * a permanent/malformed-payload failure — that one should stay recorded
 * so a redelivery of the same unparseable event doesn't get reprocessed.
 */
async function releaseWebhookClaim(provider, eventId) {
  await prisma.processedWebhookEvent.deleteMany({ where: { provider, eventId } });
}

module.exports = { claimWebhookEvent, releaseWebhookClaim };
