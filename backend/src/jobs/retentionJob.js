/**
 * Data retention.
 *
 * WebhookLog.payload holds the raw Instagram webhook body, which includes the
 * CUSTOMER's message text. That is third-party personal data, and the
 * published privacy policy commits to a 30-day limit on it.
 *
 * This nulls the payload once it is older than the window and leaves the
 * metadata row (account, event type, status, timestamp) in place, which is
 * what operational debugging actually needs. Previously the only cleanup was
 * a manual admin button (POST /api/admin/logs/prune), so in practice these
 * bodies were retained forever.
 *
 * Idempotent — safe to run repeatedly and from more than one instance.
 */

const prisma = require('../lib/prisma');

// Keep in sync with the figure stated on the /privacy page.
const WEBHOOK_PAYLOAD_RETENTION_DAYS = 30;

async function pruneWebhookPayloads({ retentionDays = WEBHOOK_PAYLOAD_RETENTION_DAYS } = {}) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const { count } = await prisma.webhookLog.updateMany({
    where: { createdAt: { lt: cutoff }, payload: { not: null } },
    data: { payload: null },
  });

  if (count > 0) {
    console.log(
      `[Retention] Redacted ${count} webhook payload(s) older than ${retentionDays} days.`
    );
  }
  return count;
}

module.exports = { pruneWebhookPayloads, WEBHOOK_PAYLOAD_RETENTION_DAYS };
