/**
 * The UI half of "every path either grants or explains".
 *
 * The frontend has no test runner (see frontend-password-fields.test.js and
 * FINDINGS.md), so this imports the one pure module every page uses to choose
 * its trial card — frontend/src/lib/trialState.js — and the copy those cards
 * render. If a summary reason maps to the wrong card, or to no card, the page
 * falls back to the paid panels and "not on a plan": the silence this exists
 * to prevent.
 */

import { describe, it, expect } from 'vitest';
import { trialCardState, replacesPlanPanels, TRIAL_CARD } from '../../frontend/src/lib/trialState.js';
import { billing } from '../../frontend/src/content/billingCopy.js';

const none = (trialStatus) => ({ status: 'NONE', plan: null, trialStatus });
const trialing = { status: 'TRIALING', plan: { code: 'TRIAL' }, trialStatus: 'TRIAL_GRANTED' };
const active = { status: 'ACTIVE', plan: { code: 'STARTER' }, trialStatus: null };

describe('trialCardState — which card a page renders', () => {
  it('trialConsumedAt already set -> the ALREADY_CONSUMED card, replacing the plan panels', () => {
    const state = trialCardState(none('TRIAL_ALREADY_CONSUMED'));
    expect(state).toBe(TRIAL_CARD.ALREADY_CONSUMED);
    expect(replacesPlanPanels(state)).toBe(true);
  });

  it('an unverified email -> the EMAIL_UNVERIFIED card', () => {
    const state = trialCardState(none('EMAIL_UNVERIFIED'));
    expect(state).toBe(TRIAL_CARD.EMAIL_UNVERIFIED);
    expect(replacesPlanPanels(state)).toBe(true);
  });

  it('nothing connected yet -> the NOT_STARTED card', () => {
    expect(trialCardState(none('TRIAL_NOT_STARTED'))).toBe(TRIAL_CARD.NOT_STARTED);
  });

  it('NONE with no reason at all (an older server) still explains — it never falls through to "no plan"', () => {
    const state = trialCardState(none(undefined));
    expect(state).toBe(TRIAL_CARD.NOT_STARTED);
    expect(replacesPlanPanels(state)).toBe(true);
  });

  it('a live trial uses the SAME panels as a paid plan — no card replaces them', () => {
    expect(trialCardState(trialing)).toBeNull();
  });

  it('straight after the connect that granted it, the confirmation shows ABOVE the panels', () => {
    const state = trialCardState(trialing, { justConnectedOutcome: 'TRIAL_GRANTED' });
    expect(state).toBe(TRIAL_CARD.GRANTED);
    expect(replacesPlanPanels(state)).toBe(false);
  });

  it('a stale ?trial=TRIAL_GRANTED cannot claim a grant the summary does not show', () => {
    expect(trialCardState(none('TRIAL_ALREADY_CONSUMED'), { justConnectedOutcome: 'TRIAL_GRANTED' })).toBe(
      TRIAL_CARD.ALREADY_CONSUMED
    );
  });

  it('a paying tenant gets no trial card', () => {
    expect(trialCardState(active)).toBeNull();
  });

  it('connected, eligible and never claimed -> the CLAIMABLE card, never the connect prompt', () => {
    const state = trialCardState(none('TRIAL_CLAIMABLE'));
    expect(state).toBe(TRIAL_CARD.CLAIMABLE);
    expect(state).not.toBe(TRIAL_CARD.NOT_STARTED);
    expect(replacesPlanPanels(state)).toBe(true);
  });

  it('a claim from the card confirms like a connect: TRIAL_GRANTED passed as the just-connected outcome', () => {
    expect(trialCardState(trialing, { justConnectedOutcome: 'TRIAL_GRANTED' })).toBe(TRIAL_CARD.GRANTED);
  });
});

describe('the claim copy', () => {
  it('CLAIMABLE offers "Start my trial" and never asks to connect', () => {
    expect(billing.trial.claimButton).toBe('Start my trial');
    expect(billing.trial.claimableTitle(3)).toContain('3-day');
    expect(billing.trial.claimableTitle(3)).not.toMatch(/connect/i);
  });

  it('every refusal a claim can return has its own line', () => {
    for (const code of ['TRIAL_ALREADY_CONSUMED', 'EMAIL_UNVERIFIED', 'TRIAL_NOT_STARTED', 'ACCOUNT_BLOCKED']) {
      expect(billing.trial.claimRefused[code], code).toBeTruthy();
    }
  });
});

describe('the copy those cards render', () => {
  it('ALREADY_CONSUMED says exactly that, with a CTA to the plans', () => {
    expect(billing.trial.consumedTitle).toBe('This Instagram account has already used its free trial');
    expect(billing.trial.plansButton).toBeTruthy();
  });

  it('the NOT_STARTED promise states its condition: one free trial per Instagram account', () => {
    expect(billing.trial.noneBody).toContain('One free trial per Instagram account');
  });

  it('EMAIL_UNVERIFIED offers a resend', () => {
    expect(billing.trial.resendButton).toBeTruthy();
  });

  it('TRIAL_GRANTED confirms days, messages sorted and auto-replies', () => {
    expect(billing.trial.grantedTitle(3)).toContain('3-day');
    expect(billing.trial.includesClassified('100')).toContain('100');
    expect(billing.trial.includesAutoReplies(25)).toContain('25');
  });

  it('"No plan yet" no longer exists anywhere in the billing copy', () => {
    const strings = JSON.stringify(billing);
    expect(strings).not.toContain('No plan yet');
  });
});
