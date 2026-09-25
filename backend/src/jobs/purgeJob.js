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
const { purgeOldJobRuns } = require('./jobRuns');

const WEBHOOK_DELIVERY_RETENTION_DAYS = 7;

// Keep in sync with the figure stated on the /privacy page.
const ADMIN_LOG_IP_RETENTION_DAYS = 90;

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

/**
 * Redact IP addresses on AdminLog rows past their retention date.
 *
 * AdminLog is not only "admin" activity — routes/auth.js also writes to it
 * with the CONNECTING CUSTOMER's own IP when Codeback refuses to link a
 * blocked or already-connected Instagram account (see
 * ACCOUNT_LINK_BLOCKED / ACCOUNT_RELINK_BLOCKED). Unlike the ledger tables,
 * this one had no purge job at all until now — see PRIVACY_NOTES.md and
 * FINDINGS.md. This clears only ipAddress; action/target/details/timestamp
 * stay, since those are what the audit trail is actually for.
 */
async function redactExpiredAdminLogIps() {
  const cutoff = new Date(Date.now() - ADMIN_LOG_IP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.adminLog.updateMany({
    where: { createdAt: { lt: cutoff }, ipAddress: { not: null } },
    data: { ipAddress: null },
  });
  if (count > 0) {
    console.log(`[Retention] Redacted ${count} admin log IP address(es) older than ${ADMIN_LOG_IP_RETENTION_DAYS} days.`);
  }
  return count;
}

/** Everything that just needs periodic tidying. */
async function runHousekeeping() {
  const results = {
    webhookDeliveries: 0,
    authTokens: 0,
    oauthNonces: 0,
    identities: 0,
    adminLogIps: 0,
    jobRuns: 0,
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
  try {
    results.adminLogIps = await redactExpiredAdminLogIps();
  } catch (err) {
    console.error('[Jobs] redactExpiredAdminLogIps failed:', err.message);
  }
  try {
    results.jobRuns = await purgeOldJobRuns();
  } catch (err) {
    console.error('[Jobs] purgeOldJobRuns failed:', err.message);
  }

  return results;
}

module.exports = {
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  ADMIN_LOG_IP_RETENTION_DAYS,
  purgeWebhookDeliveries,
  purgeExpiredIdentities,
  redactExpiredAdminLogIps,
  runHousekeeping,
};
