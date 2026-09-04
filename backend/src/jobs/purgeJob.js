/**
 * Housekeeping for tables that grow without bound.
 *
 * webhook_deliveries is the important one. Unlike the Cashfree table it
 * replaced — which only ever saw 13 payment events — EVERY INBOUND DM writes a
 * row here. Without this sweep it becomes the largest table in the database
 * and its unique index degrades the webhook hot path, which is the one path
 * that must stay fast enough to return 200 inside Meta's timeout.
 *
 * See FINDINGS.md D4: the 7-day purge is a requirement of the design, not a
 * nice-to-have. Meta does not retry a delivery for anything close to 7 days,
 * so nothing is lost.
 */

const prisma = require('../lib/prisma');
const authTokens = require('../lib/authTokens');
const oauthState = require('../lib/oauthState');

const WEBHOOK_DELIVERY_RETENTION_DAYS = 7;

/** Drop delivery-idempotency rows older than the retention window. */
async function purgeWebhookDeliveries({ olderThanDays = WEBHOOK_DELIVERY_RETENTION_DAYS } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.webhookDelivery.deleteMany({
    where: { receivedAt: { lt: cutoff } },
  });
  if (count > 0) console.log(`[Jobs] Purged ${count} webhook delivery record(s).`);
  return count;
}

/**
 * Drop pseudonymised ledger rows past their retention date.
 *
 * InstagramIdentity is retained 18-24 months for fraud prevention and is
 * documented as such in PRIVACY_NOTES.md. purgeAfter is set on write, so this
 * only removes rows whose own retention clock has run out.
 */
async function purgeExpiredIdentities() {
  const { count } = await prisma.instagramIdentity.deleteMany({
    where: { purgeAfter: { lt: new Date() } },
  });
  if (count > 0) console.log(`[Jobs] Purged ${count} expired identity ledger row(s).`);
  return count;
}

/** Everything that just needs periodic tidying. */
async function runHousekeeping() {
  const results = {
    webhookDeliveries: 0,
    authTokens: 0,
    oauthNonces: 0,
    identities: 0,
  };

  // Each is independent; one failure must not stop the rest.
  try {
    results.webhookDeliveries = await purgeWebhookDeliveries();
  } catch (err) {
    console.error('[Jobs] purgeWebhookDeliveries failed:', err.message);
  }
  try {
    results.authTokens = await authTokens.purgeExpiredTokens();
  } catch (err) {
    console.error('[Jobs] purgeExpiredTokens failed:', err.message);
  }
  try {
    results.oauthNonces = await oauthState.purgeExpiredNonces();
  } catch (err) {
    console.error('[Jobs] purgeExpiredNonces failed:', err.message);
  }
  try {
    results.identities = await purgeExpiredIdentities();
  } catch (err) {
    console.error('[Jobs] purgeExpiredIdentities failed:', err.message);
  }

  return results;
}

module.exports = {
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  purgeWebhookDeliveries,
  purgeExpiredIdentities,
  runHousekeeping,
};
