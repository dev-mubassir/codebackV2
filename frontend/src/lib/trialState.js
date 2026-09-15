/**
 * Which pre-payment card a page shows — the ONE decision the billing page, the
 * dashboard and the settings panel all share.
 *
 * The server says WHY a tenant has no trial (summary.trialStatus, derived from
 * the Instagram identity ledger and the email verification stamp). This turns
 * that into what to render. Keeping it in one place is what makes "No plan
 * yet" unreachable: a tenant with nothing always maps to a state that explains
 * itself, on every page, rather than each page deciding separately and one of
 * them falling through to a blank.
 *
 * DEPENDENCY-FREE ON PURPOSE. The frontend has no test runner; the backend
 * suite imports this file directly (tests/trial-ui-state.test.js).
 */

export const TRIAL_CARD = {
  /** No account that could claim a trial is connected yet. */
  NOT_STARTED: 'TRIAL_NOT_STARTED',
  /** A trial was just granted — the confirmation, shown once after connecting. */
  GRANTED: 'TRIAL_GRANTED',
  /** Every connected Instagram account has already had its one free trial. */
  ALREADY_CONSUMED: 'TRIAL_ALREADY_CONSUMED',
  /** A trial needs a confirmed email address first. */
  EMAIL_UNVERIFIED: 'EMAIL_UNVERIFIED',
};

const EXPLAINED = new Set([TRIAL_CARD.NOT_STARTED, TRIAL_CARD.ALREADY_CONSUMED, TRIAL_CARD.EMAIL_UNVERIFIED]);

/**
 * @param {object|null} summary  GET /api/billing/summary
 * @param {object} [opts]
 * @param {string|null} [opts.justConnectedOutcome]  the `?trial=` code the connect
 *   redirect carried, if the page was reached straight from connecting
 * @returns {string|null} a TRIAL_CARD value, or null when the normal plan panels apply
 */
export function trialCardState(summary, { justConnectedOutcome = null } = {}) {
  if (!summary) return null;
  const reason = summary.trialStatus;

  // A live trial renders in the same panels as a paid plan. The confirmation
  // card is additive, and only straight after the connect that granted it.
  if (reason === TRIAL_CARD.GRANTED) {
    return justConnectedOutcome === TRIAL_CARD.GRANTED ? TRIAL_CARD.GRANTED : null;
  }

  if (EXPLAINED.has(reason)) return reason;

  // Defence in depth: a tenant with no entitlement must never reach the paid
  // panels' "not on a plan" state, even if an older server sent no reason.
  if (summary.status === 'NONE') return TRIAL_CARD.NOT_STARTED;

  return null;
}

/** True when the card REPLACES the plan/credits/usage panels, rather than sitting above them. */
export function replacesPlanPanels(state) {
  return EXPLAINED.has(state);
}
