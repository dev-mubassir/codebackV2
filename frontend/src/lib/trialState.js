/**
 * Which pre-payment card a page shows — the ONE decision the billing page, the
 * dashboard and the settings panel all share.
 *
 * The server says WHY a tenant has no trial (summary.trialStatus, decided by
 * igIdentity.trialDecision — the same rules a claim runs) and WHETHER an
 * Instagram account is connected (summary.instagramConnected). This turns the
 * two into what to render. Keeping it in one place is what makes "No plan
 * yet" unreachable: a tenant with nothing always maps to a state that explains
 * itself, on every page.
 *
 * TWO AXES, NOT ONE. "No entitlement" and "no Instagram connected" are
 * different situations, and treating them as one is how a user with Instagram
 * connected was told "Connect an Instagram account to start your trial":
 *
 *   entitlement  instagram      card
 *   none         not connected  NOT_STARTED (connect), or EMAIL_UNVERIFIED
 *   none         connected      CLAIMABLE | ALREADY_CONSUMED | EMAIL_UNVERIFIED | BLOCKED
 *                               — never the connect card
 *   trialing     connected      none here: the usage panels (GRANTED once, after a connect or claim)
 *   paid         connected      none here: the usage panels
 *
 * DEPENDENCY-FREE ON PURPOSE. The frontend has no test runner; the backend
 * suite imports this file directly (tests/trial-ui-state.test.js).
 */

export const TRIAL_CARD = {
  /** No account that could claim a trial is connected yet. */
  NOT_STARTED: 'TRIAL_NOT_STARTED',
  /** A trial was just granted — the confirmation, shown once after connecting or claiming. */
  GRANTED: 'TRIAL_GRANTED',
  /** Every connected Instagram account has already had its one free trial. */
  ALREADY_CONSUMED: 'TRIAL_ALREADY_CONSUMED',
  /** A trial needs a confirmed email address first. */
  EMAIL_UNVERIFIED: 'EMAIL_UNVERIFIED',
  /** Instagram is connected and eligible, but no trial was ever started — offer "Start my trial". */
  CLAIMABLE: 'TRIAL_CLAIMABLE',
  /** The connected Instagram account is blocked from free trials. */
  BLOCKED: 'ACCOUNT_BLOCKED',
};

const EXPLAINED = new Set([
  TRIAL_CARD.NOT_STARTED,
  TRIAL_CARD.ALREADY_CONSUMED,
  TRIAL_CARD.EMAIL_UNVERIFIED,
  TRIAL_CARD.CLAIMABLE,
  TRIAL_CARD.BLOCKED,
]);

/**
 * @param {object|null} summary  GET /api/billing/summary
 * @param {object} [opts]
 * @param {string|null} [opts.justConnectedOutcome]  the outcome of a connect or claim
 *   the page just completed (`?trial=` on the connect redirect, or the claim response)
 * @returns {string|null} a TRIAL_CARD value, or null when the normal plan panels apply
 */
export function trialCardState(summary, { justConnectedOutcome = null } = {}) {
  if (!summary) return null;
  const reason = summary.trialStatus;
  const connected = summary.instagramConnected === true;

  // A live trial renders in the same panels as a paid plan. The confirmation
  // card is additive, and only straight after the connect or claim that granted it.
  if (reason === TRIAL_CARD.GRANTED) {
    return justConnectedOutcome === TRIAL_CARD.GRANTED ? TRIAL_CARD.GRANTED : null;
  }

  // Never tell a connected user to connect. If the reason and the connection
  // ever disagree, offer the claim: the server applies the real rules to it
  // and answers a refusal with the reason, so the button cannot promise
  // anything false.
  if (connected && reason === TRIAL_CARD.NOT_STARTED) return TRIAL_CARD.CLAIMABLE;

  if (EXPLAINED.has(reason)) return reason;

  // Defence in depth: a tenant with no entitlement must never reach the paid
  // panels' "not on a plan" state, even if an older server sent no reason.
  if (summary.status === 'NONE') return connected ? TRIAL_CARD.CLAIMABLE : TRIAL_CARD.NOT_STARTED;

  return null;
}

/** True when the card REPLACES the plan/credits/usage panels, rather than sitting above them. */
export function replacesPlanPanels(state) {
  return EXPLAINED.has(state);
}
