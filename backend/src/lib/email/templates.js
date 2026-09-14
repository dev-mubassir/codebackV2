/**
 * Email content, in one place.
 *
 * Every template returns { subject, text, html }. Plain text is not optional —
 * a text/plain alternative materially improves deliverability and is what most
 * spam filters score against.
 *
 * No template ever embeds a secret other than the one-time link it exists to
 * deliver, and no template logs.
 */

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@siffty.com';

/** Shared shell so every message looks like it came from the same product. */
function wrap(heading, bodyHtml) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">${heading}</h1>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px;" />
      <p style="margin:0;font-size:12px;color:#6b7280;">
        Siffty · Questions? Reply to this email or write to
        <a href="mailto:${SUPPORT_EMAIL}" style="color:#6b7280;">${SUPPORT_EMAIL}</a>
      </p>
    </div>
  </body>
</html>`;
}

function button(url, label) {
  return `<p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${label}</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">If the button does not work, paste this into your browser:</p>
    <p style="margin:0;font-size:13px;word-break:break-all;color:#374151;">${url}</p>`;
}

const templates = {
  passwordReset({ url, expiresInMinutes }) {
    return {
      subject: 'Reset your Siffty password',
      text:
        `Someone asked to reset the password for this Siffty account.\n\n` +
        `Reset it here (link expires in ${expiresInMinutes} minutes, and works once):\n${url}\n\n` +
        `If this wasn't you, ignore this email — your password has not changed.\n\n` +
        `Siffty · ${SUPPORT_EMAIL}\n`,
      html: wrap(
        'Reset your password',
        `<p style="margin:0;font-size:15px;line-height:1.5;">Someone asked to reset the password for this Siffty account.</p>
         ${button(url, 'Reset password')}
         <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">This link expires in ${expiresInMinutes} minutes and can only be used once. If this wasn't you, ignore this email — your password has not changed.</p>`
      ),
    };
  },

  verification({ url, expiresInMinutes }) {
    return {
      subject: 'Confirm your email for Siffty',
      text:
        `Confirm this email address to finish setting up your Siffty account.\n\n` +
        `Confirm here (link expires in ${expiresInMinutes} minutes):\n${url}\n\n` +
        `You need a confirmed email before you can start your trial.\n\n` +
        `Siffty · ${SUPPORT_EMAIL}\n`,
      html: wrap(
        'Confirm your email',
        `<p style="margin:0;font-size:15px;line-height:1.5;">Confirm this email address to finish setting up your Siffty account.</p>
         ${button(url, 'Confirm email')}
         <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">This link expires in ${expiresInMinutes} minutes. You need a confirmed email before you can start your trial.</p>`
      ),
    };
  },

  tokenExpiry({ igUsername, reconnectUrl }) {
    const who = igUsername ? `@${igUsername}` : 'your Instagram account';
    return {
      subject: `Reconnect ${who} — Siffty has stopped receiving your DMs`,
      text:
        `Instagram's access token for ${who} is no longer valid, so Siffty has stopped receiving new DMs for it.\n\n` +
        `Nothing has been deleted — your inbox history is intact. Reconnecting takes about ten seconds:\n${reconnectUrl}\n\n` +
        `Until you reconnect, new messages will not appear and auto-replies will not send.\n\n` +
        `Siffty · ${SUPPORT_EMAIL}\n`,
      html: wrap(
        `Reconnect ${who}`,
        `<p style="margin:0;font-size:15px;line-height:1.5;">Instagram's access token for <strong>${who}</strong> is no longer valid, so Siffty has stopped receiving new DMs for it.</p>
         <p style="margin:12px 0 0;font-size:15px;line-height:1.5;">Nothing has been deleted — your inbox history is intact.</p>
         ${button(reconnectUrl, 'Reconnect Instagram')}
         <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">Until you reconnect, new messages will not appear and auto-replies will not send.</p>`
      ),
    };
  },

  deletionConfirmation({ igUsername, accountDeleted, confirmationCode, statusUrl }) {
    const who = igUsername ? `@${igUsername}` : 'your Instagram account';
    const accountLine = accountDeleted
      ? ' This was the only Instagram account on your Siffty account, so your Siffty account was deleted too.'
      : '';
    return {
      subject: `Siffty has deleted the data for ${who}`,
      text:
        `Instagram told Siffty you asked to delete your data, and the request is complete.\n\n` +
        `Erased: every contact, conversation, message, analysis, and stored record tied to ${who}.${accountLine}\n\n` +
        `Confirmation code: ${confirmationCode}\n` +
        `Check the status of this request: ${statusUrl}\n\n` +
        `Questions? ${SUPPORT_EMAIL}\n\n` +
        `Siffty · ${SUPPORT_EMAIL}\n`,
      html: wrap(
        `Data deleted for ${who}`,
        `<p style="margin:0;font-size:15px;line-height:1.5;">Instagram told Siffty you asked to delete your data, and the request is complete.</p>
         <p style="margin:12px 0 0;font-size:15px;line-height:1.5;">Erased: every contact, conversation, message, analysis, and stored record tied to <strong>${who}</strong>.${accountLine}</p>
         <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">Confirmation code: <strong>${confirmationCode}</strong></p>
         ${button(statusUrl, 'Check status')}`
      ),
    };
  },

  /**
   * Internal ops alert — NOT customer-facing. One digest per reconciliation
   * run, never one email per mismatch (see billingReconciliationJob.js).
   * A mismatch means a customer paid and a webhook was dropped; this is the
   * "money is unaccounted for" signal reaching a human.
   */
  billingReconciliationMismatch({ mismatches, checked }) {
    const rows = mismatches
      .map(
        (m) =>
          `- order ${m.cashfreeOrderId} · tenant ${m.tenantId} · ${m.planCode || m.addonCode} · healed: ${m.healed ? 'yes' : 'NO — see logs'}`
      )
      .join('\n');
    const rowsHtml = mismatches
      .map(
        (m) =>
          `<li style="margin:0 0 6px;">order <code>${m.cashfreeOrderId}</code> · tenant <code>${m.tenantId}</code> · ${m.planCode || m.addonCode} · healed: <strong>${m.healed ? 'yes' : 'NO — see logs'}</strong></li>`
      )
      .join('');
    return {
      subject: `[Siffty billing] ${mismatches.length} webhook mismatch(es) found in reconciliation`,
      text:
        `Nightly billing reconciliation checked ${checked} pending order(s) and found ${mismatches.length} ` +
        `paid at Cashfree but not reflected in our database — a webhook was dropped for each.\n\n` +
        `${rows}\n\n` +
        `"healed: yes" means the plan/add-on was granted automatically during this run. "NO" means it was not — check the server logs for that order immediately.\n\n` +
        `Siffty · ${SUPPORT_EMAIL}\n`,
      html: wrap(
        `${mismatches.length} billing mismatch(es)`,
        `<p style="margin:0;font-size:15px;line-height:1.5;">Nightly billing reconciliation checked ${checked} pending order(s) and found ${mismatches.length} paid at Cashfree but not reflected in our database — a webhook was dropped for each.</p>
         <ul style="margin:16px 0 0;padding-left:20px;font-size:14px;line-height:1.6;">${rowsHtml}</ul>
         <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">"healed: yes" means the plan/add-on was granted automatically during this run. "NO" means it was not — check the server logs for that order immediately.</p>`
      ),
    };
  },

  trialEnding({ daysLeft, dashboardUrl }) {
    const when = daysLeft <= 0 ? 'has ended' : daysLeft === 1 ? 'ends tomorrow' : `ends in ${daysLeft} days`;
    return {
      subject: `Your Siffty trial ${when}`,
      text:
        `Your Siffty trial ${when}.\n\n` +
        `When it ends, automatic replies and AI classification stop. Your inbox stays readable and nothing is deleted — you keep full access to your message history.\n\n` +
        `${dashboardUrl}\n\n` +
        `Siffty · ${SUPPORT_EMAIL}\n`,
      html: wrap(
        `Your trial ${when}`,
        `<p style="margin:0;font-size:15px;line-height:1.5;">Your Siffty trial ${when}.</p>
         <p style="margin:12px 0 0;font-size:15px;line-height:1.5;">When it ends, automatic replies and AI classification stop. <strong>Your inbox stays readable and nothing is deleted</strong> — you keep full access to your message history.</p>
         ${button(dashboardUrl, 'Open Siffty')}`
      ),
    };
  },
};

module.exports = templates;
