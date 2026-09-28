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

/**
 * Escape text for HTML. Every other template here renders values this server
 * produced itself; the contact enquiry is the first to carry text a visitor
 * typed, and that text lands in a support inbox where an injected link or form
 * would look like it came from us.
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** A single line for a subject: no CR/LF (header injection), bounded length. */
function oneLine(value, max = 80) {
  const flat = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function button(url, label) {
  return `<p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${label}</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">If the button does not work, paste this into your browser:</p>
    <p style="margin:0;font-size:13px;word-break:break-all;color:#374151;">${url}</p>`;
}

/**
 * What actually happens at expiry, in one place so all four renewal stages
 * tell the identical story.
 *
 * These sentences are not marketing — they are a description of what the code
 * does, and they have to stay true to it. canAutoReply() refuses anything past
 * validUntil (GRACE is deliberately excluded), while classificationGateReason()
 * keeps going through GRACE — so auto-replies stop ON the expiry date and
 * classification survives the grace window. Nothing is ever deleted, and the
 * account is never locked; see jobs/trialJob.js's note on why locking someone
 * out of their own customer conversations to sell them a plan is hostile.
 *
 * If entitlementService's rules change, this paragraph is a lie until it is
 * changed with them.
 */
const RENEWAL_WHAT_STOPS_TEXT =
  'When a plan expires, automatic replies stop. AI classification keeps running through the three-day grace period, ' +
  'and your inbox stays readable the whole time — nothing is deleted and you are never locked out of your account.';

/**
 * The four stages of the renewal sequence.
 *
 * "Renewing early loses you nothing" is stated on the two pre-expiry stages
 * because it is TRUE and it removes the only rational reason to wait:
 * grantPlan() anchors a warm renewal to the existing validUntil, not to today
 * (see its RENEWAL DATE MATH note), so renewing three days early still buys a
 * full cycle. Without that sentence the day-27 nudge is asking someone to
 * donate three days.
 *
 * GRACE_FINAL is the last message in the sequence — there is no day-3 notice,
 * because a message arriving as the grace window closes cannot be acted on.
 * Alone among the four it names the EXACT instant the credit bank is
 * cleared, because it is the only one where something is about to be lost
 * irreversibly and "today" is not good enough to act on.
 */
const RENEWAL_STAGES = {
  DAY_27: {
    subjectLead: 'Your Siffty plan expires in 3 days',
    lead: 'Your Siffty plan expires in three days.',
    detail:
      'Renewing now extends from your current expiry date, not from today, so renewing early costs you nothing.',
  },
  DAY_29: {
    subjectLead: 'Your Siffty plan expires tomorrow',
    lead: 'Your Siffty plan expires tomorrow.',
    detail:
      'Renewing now extends from your current expiry date, not from today, so you keep the day you have left.',
  },
  EXPIRY: {
    subjectLead: 'Your Siffty plan expires today',
    lead: 'Your Siffty plan expires today, and automatic replies stop when it does.',
    detail:
      'You have three days of grace after that to renew without losing anything. Renewing during it extends from today, so the cycle you paid for is not cut short.',
  },
  GRACE_FINAL: {
    subjectLead: 'Your Siffty plan has expired',
    lead: 'Your Siffty plan has expired and automatic replies have stopped.',
    // A FUNCTION, unlike the other three, because this is the only message
    // where the customer is about to lose something irreversibly and the
    // deadline is the entire point. "Today" and "soon" are useless to
    // someone reading at 11pm in a timezone we did not pick — so this names
    // the actual instant the bank is cleared, from their own graceUntil.
    detail: ({ forfeitAt }) =>
      forfeitAt
        ? `This is the last day of your grace period. Renew before ${forfeitAt} and everything picks up where it left off. After that your unused replies are cleared and the next cycle starts from zero.`
        : 'This is the last day of your grace period. Renew now and everything picks up where it left off; after it ends your unused replies are cleared and the next cycle starts from zero.',
  },
};

/**
 * The forfeiture deadline, written out in full.
 *
 * IST, named explicitly. Most customers are in India, and an unlabelled
 * time on a message about losing credits is worse than no time at all —
 * a reader who assumes their own zone can be hours wrong in the direction
 * that costs them the balance.
 */
function formatDeadline(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })} IST`;
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
  /**
   * CRITICAL internal alert — a plan downgrade was GRANTED while the customer's
   * paid plan was still active. Checkout refuses that purchase, so this is an
   * order that pre-dates the block or a path that bypassed checkout, and the
   * payment has already been taken. Not customer-facing.
   */
  billingPlanAnomaly({ tenantId, fromPlanCode, toPlanCode, paidUntil, newValidUntil, carriedBalance, discarded }) {
    const iso = (d) => (d ? new Date(d).toISOString() : 'unknown');
    const facts = [
      `tenant: ${tenantId}`,
      `plan change: ${fromPlanCode} -> ${toPlanCode}`,
      `${fromPlanCode} was paid until: ${iso(paidUntil)}`,
      `new validUntil: ${iso(newValidUntil)}`,
      `credits carried into the bank: ${carriedBalance}`,
      `credits discarded (EXPIRE row written): ${discarded}`,
    ];
    const lead =
      `A ${fromPlanCode} -> ${toPlanCode} downgrade was granted while ${fromPlanCode} was still active. ` +
      `Checkout refuses this purchase, so it came from an order that pre-dates the block or a path that bypassed checkout — and the payment has already been taken.`;
    const next = `The customer is on ${toPlanCode} now. Check the order, then decide whether to refund it or restore ${fromPlanCode}.`;
    return {
      subject: `[Siffty billing] Downgrade granted during an active paid plan — tenant ${tenantId}`,
      text: `${lead}\n\n${facts.join('\n')}\n\n${next}\n\nSiffty · ${SUPPORT_EMAIL}\n`,
      html: wrap(
        'Downgrade granted during an active paid plan',
        `<p style="margin:0;font-size:15px;line-height:1.5;">${lead}</p>
         <ul style="margin:16px 0 0;padding-left:20px;font-size:14px;line-height:1.6;">${facts.map((f) => `<li><code>${f}</code></li>`).join('')}</ul>
         <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">${next}</p>`
      ),
    };
  },

  /**
   * A visitor's message from /contact or /contact/enterprise, delivered to
   * SUPPORT_EMAIL. Not customer-facing.
   *
   * The two kinds get different subject prefixes so an Enterprise enquiry is
   * identifiable in the inbox at a glance rather than mixed into support.
   *
   * IDENTITY IS STATED, NOT ASSUMED. `account` is set only from the server-side
   * session; the typed email address is self-reported, and the message says
   * which of the two it is looking at — a reply that acts on someone's account
   * must be based on the first, never the second.
   */
  contactEnquiry({ kind, name, fromEmail, company = null, igAccounts = null, message, account = null, submittedAt = new Date() }) {
    const isEnterprise = kind === 'enterprise';
    const label = isEnterprise ? 'enterprise' : 'support';
    const identity = account
      ? `Signed in as ${account.email || '(no email)'} — account ${account.userId}. Verified by session.`
      : 'Not signed in. The email address below is self-reported and unverified.';
    const facts = [
      ['Name', name],
      ['Email (reply-to)', fromEmail],
      ...(isEnterprise ? [['Company', company], ['Instagram accounts', igAccounts]] : []),
      ['Submitted', new Date(submittedAt).toISOString()],
    ].filter(([, v]) => v != null && v !== '');

    const subjectTail = isEnterprise ? oneLine(company || name) : oneLine(message, 60);
    return {
      subject: `[Siffty ${label}] ${subjectTail || 'New enquiry'}`,
      text:
        `New ${label} enquiry from the contact page.\n\n${identity}\n\n` +
        `${facts.map(([k, v]) => `${k}: ${oneLine(v, 300)}`).join('\n')}\n\n` +
        `Message:\n${String(message)}\n`,
      html: wrap(
        `New ${label} enquiry`,
        `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;"><strong>${escapeHtml(identity)}</strong></p>
         <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.6;">${facts
           .map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(oneLine(v, 300))}</li>`)
           .join('')}</ul>
         <p style="margin:0;font-size:15px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(message)}</p>`
      ),
    };
  },

  /**
   * CRITICAL internal billing alerts (lib/billingAlerts.js). Not customer-facing.
   * One template, a heading and lead per kind, and every detail listed — the
   * reader needs the ids to act, not a summary of them.
   */
  billingOpsAlert({ kind, details = {} }) {
    const copy = {
      paidAfterExpiry: {
        heading: 'Payment received on an expired order',
        lead: 'Cashfree confirmed a payment on an order Siffty had already expired. Nothing was granted, but the money was taken.',
        next: 'Refund the payment, or grant the plan/add-on by hand.',
      },
      staleOrdersExpired: {
        heading: '7-day order expiry safety net fired',
        lead: 'Orders sat unpaid and unresolved for 7 days. Cashfree orders expire after 60 minutes and reconciliation should have resolved these long before, so something is not checking them.',
        next: 'Check the reconciliation job logs and confirm none of these orders was actually paid at Cashfree.',
      },
      partialRefund: {
        heading: 'Partial refund succeeded — access unchanged',
        lead: 'A partial refund completed at Cashfree. Partial refunds do not revoke anything automatically, so the customer keeps everything the order granted.',
        next: 'Decide whether any access or credits should be adjusted by hand.',
      },
      refundOutsideSiffty: {
        heading: 'Refund initiated outside Siffty',
        lead: 'A refund Siffty did not initiate (for example from the Cashfree dashboard) reached the webhook. It has been recorded and processed like any other.',
        next: 'Confirm the refund was intended, and who issued it.',
      },
      refundSnapshotMissing: {
        heading: 'Refund revoked without a grant snapshot',
        lead: 'A fully refunded order was fulfilled before grant snapshots were recorded, so its revocation used a best estimate (one cycle of validity and the plan or pack credit amount).',
        next: "Check the tenant's plan dates and credits against what the order actually granted.",
      },
    }[kind] || { heading: `Billing alert: ${kind}`, lead: 'An unrecognised billing alert kind was raised.', next: 'Check the server logs.' };

    const show = (v) => (v instanceof Date ? v.toISOString() : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
    const facts = Object.entries(details).map(([k, v]) => `${k}: ${show(v)}`);

    return {
      subject: `[Siffty billing] ${copy.heading}`,
      text: `${copy.lead}\n\n${facts.join('\n')}\n\n${copy.next}\n\nSiffty · ${SUPPORT_EMAIL}\n`,
      html: wrap(
        escapeHtml(copy.heading),
        `<p style="margin:0;font-size:15px;line-height:1.5;">${escapeHtml(copy.lead)}</p>
         <ul style="margin:16px 0 0;padding-left:20px;font-size:14px;line-height:1.6;">${facts.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join('')}</ul>
         <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">${escapeHtml(copy.next)}</p>`
      ),
    };
  },

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

  /**
   * The paid renewal sequence (jobs/renewalReminderJob.js) — day 27, day 29,
   * expiry day, grace day 2. One template, four stages, because every stage
   * says the same thing with a different amount of urgency; splitting it into
   * four templates would mean four places to fix the same wording.
   *
   * WHY THE SUBJECT CARRIES A NUMBER. There is no autopay on this product, so
   * every renewal is a decision someone has to actively make. Unused reply
   * credits are the only lever in the box that is both concrete and already
   * theirs — "you have 340 unused replies waiting" is a loss they can picture,
   * where "your plan expires soon" is an errand. The count therefore goes in
   * the SUBJECT, not buried in the body, because most of these are never
   * opened.
   *
   * ZERO CREDITS IS A SEPARATE CASE, not a formatting edge. "You have 0 unused
   * replies waiting" advertises that renewing recovers nothing, which is worse
   * than saying nothing at all — so the clause is dropped entirely and the
   * subject falls back to the plain expiry statement.
   *
   * The count is printed as bare digits rather than toLocaleString(): a
   * thousands separator is locale-dependent, and a subject line that renders
   * differently depending on the server's locale is not worth the polish.
   */
  renewalReminder({ reminderType, unusedCredits = 0, checkoutUrl, forfeitAt = null }) {
    const stage = RENEWAL_STAGES[reminderType];
    if (!stage) {
      throw new Error(`templates.renewalReminder: unknown reminderType "${reminderType}"`);
    }

    // GRACE_FINAL's detail is a function of the real deadline; the other
    // three are plain strings.
    const detail =
      typeof stage.detail === 'function'
        ? stage.detail({ forfeitAt: formatDeadline(forfeitAt) })
        : stage.detail;

    const credits = Number.isFinite(unusedCredits) ? Math.max(0, unusedCredits) : 0;
    const noun = credits === 1 ? 'reply' : 'replies';
    // No trailing period — every other subject in this file is a fragment.
    const subject = credits > 0
      ? `${stage.subjectLead} — you have ${credits} unused ${noun} waiting`
      : stage.subjectLead;

    // Stated only when there is something to carry over. The cap is described
    // rather than quoted: the real number is Plan.autoReplyBankCap, and
    // promising a specific figure here would be a second copy of it to get
    // wrong (see entitlementService.computeBankRollover — excess IS discarded).
    const creditsText = credits > 0
      ? `You have ${credits} unused ${noun}. Renew before the grace period ends and they carry over into your next cycle, up to your plan's limit. After that the balance is cleared and the new cycle starts from zero.\n\n`
      : '';
    const creditsHtml = credits > 0
      ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.5;">You have <strong>${credits} unused ${noun}</strong>. Renew before the grace period ends and they carry over into your next cycle, up to your plan's limit. After that the balance is cleared and the new cycle starts from zero.</p>`
      : '';

    return {
      subject,
      text:
        `${stage.lead}\n\n` +
        `${detail}\n\n` +
        creditsText +
        `Renew here:\n${checkoutUrl}\n\n` +
        `${RENEWAL_WHAT_STOPS_TEXT}\n\n` +
        `Siffty · ${SUPPORT_EMAIL}\n`,
      html: wrap(
        stage.subjectLead,
        `<p style="margin:0;font-size:15px;line-height:1.5;">${stage.lead}</p>
         <p style="margin:12px 0 0;font-size:15px;line-height:1.5;">${detail}</p>
         ${creditsHtml}
         ${button(checkoutUrl, 'Renew my plan')}
         <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">${RENEWAL_WHAT_STOPS_TEXT}</p>`
      ),
    };
  },

  /**
   * Admin security alerts — to the admin's own address, never a customer.
   * `facts` are server-produced (time, IP, user agent), but the user agent is
   * attacker-controlled text, so every value is escaped and flattened.
   */
  adminSecurityAlert({ kind, facts = {} }) {
    const copy = {
      login: {
        heading: 'New sign-in to the Siffty admin panel',
        lead: 'Someone signed in to the admin panel with your admin account.',
        next: 'If this was not you, run scripts/reset-admin-password.js immediately. That also signs out every admin session.',
      },
      lockout: {
        heading: 'Admin account locked after failed sign-ins',
        lead: 'Your admin account was locked for 15 minutes after repeated wrong passwords.',
        next: 'If this was not you, someone is guessing your admin password. Consider resetting it with scripts/reset-admin-password.js.',
      },
    }[kind] || { heading: `Admin alert: ${kind}`, lead: 'An admin security event occurred.', next: 'Check the admin audit log.' };

    const lines = Object.entries(facts).map(([k, v]) => `${k}: ${oneLine(v, 300)}`);
    return {
      subject: `[Siffty admin] ${copy.heading}`,
      text: `${copy.lead}\n\n${lines.join('\n')}\n\n${copy.next}\n`,
      html: wrap(
        escapeHtml(copy.heading),
        `<p style="margin:0;font-size:15px;line-height:1.5;">${escapeHtml(copy.lead)}</p>
         <ul style="margin:16px 0 0;padding-left:20px;font-size:14px;line-height:1.6;">${lines.map((l) => `<li><code>${escapeHtml(l)}</code></li>`).join('')}</ul>
         <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">${escapeHtml(copy.next)}</p>`
      ),
    };
  },

  /**
   * Operational alert to the admins (lib/adminAlerts.js): token refresh
   * failures, and the Gate 7 threshold alerts. `facts` are counts, ids,
   * handles and codes; every value is still escaped and flattened.
   */
  adminOpsAlert({ title, lead, facts = [] }) {
    const lines = facts.map((f) => oneLine(f, 300));
    return {
      subject: `[Siffty admin] ${oneLine(title, 120)}`,
      text: `${lead}\n\n${lines.join('\n')}\n\nOpen the admin Health page for details.\n`,
      html: wrap(
        escapeHtml(title),
        `<p style="margin:0;font-size:15px;line-height:1.5;">${escapeHtml(lead)}</p>
         <ul style="margin:16px 0 0;padding-left:20px;font-size:14px;line-height:1.6;">${lines.map((l) => `<li><code>${escapeHtml(l)}</code></li>`).join('')}</ul>
         <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">Open the admin Health page for details.</p>`
      ),
    };
  },

  autodmUsage({ level, used, limit, resetsAt, url }) {
    const n = (x) => Number(x).toLocaleString('en-IN');
    const date = resetsAt ? new Date(resetsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null;
    const full = level >= 100;
    const subject = full ? "You've used all your Auto DMs for this billing period" : "You've used 80% of your Auto DMs";
    const lead = `You've sent ${n(used)} of ${n(limit)} Auto DMs this billing period.`;
    const next = full
      ? `New comments that match your automations are held, not dropped. They send automatically when your plan renews${date ? ` on ${date}` : ''} or when you upgrade. Instagram only allows the reply within 7 days of the comment, so held comments older than that expire.`
      : `When you reach ${n(limit)}, new comments wait until your plan renews${date ? ` on ${date}` : ''} or you upgrade. Nothing is lost for up to 7 days.`;
    return {
      subject,
      text: `${lead}

${next}

${url}

Siffty · ${SUPPORT_EMAIL}
`,
      html: wrap(
        escapeHtml(subject),
        `<p style="margin:0;font-size:15px;line-height:1.5;">${escapeHtml(lead)}</p>
         <p style="margin:12px 0 0;font-size:15px;line-height:1.5;">${escapeHtml(next)}</p>
         ${button(url, 'Open Auto DM')}`
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
