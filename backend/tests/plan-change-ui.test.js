/**
 * The UI half of the downgrade block: the pure helper every plan card and the
 * checkout dialog read (frontend/src/lib/planChange.js), and the copy they
 * render. The frontend has no test runner, so this runs in the backend suite.
 */

import { describe, it, expect } from 'vitest';
import { planBlock, PLAN_DOWNGRADE_BLOCKED } from '../../frontend/src/lib/planChange.js';
import { billing } from '../../frontend/src/content/billingCopy.js';

const proActive = { planChange: { blockedPlanCodes: ['STARTER'], availableFrom: '2026-10-14T17:30:00.000Z' } };

describe('planBlock — which card shows the blocked state', () => {
  it('the blocked lower tier gets its availability date', () => {
    expect(planBlock(proActive, 'STARTER')).toEqual({ availableFrom: '2026-10-14T17:30:00.000Z' });
  });

  it('any other plan is purchasable', () => {
    expect(planBlock(proActive, 'PRO')).toBeNull();
  });

  it('no summary, or an older server without planChange, blocks nothing', () => {
    expect(planBlock(null, 'STARTER')).toBeNull();
    expect(planBlock({}, 'STARTER')).toBeNull();
  });

  it('matches the machine-readable code the checkout API returns', () => {
    expect(PLAN_DOWNGRADE_BLOCKED).toBe('PLAN_DOWNGRADE_BLOCKED');
  });
});

describe('the blocked-state copy', () => {
  it('names the date on the card and in the dialog — never a generic error', () => {
    expect(billing.planChange.blockedButton('14 Oct 2026')).toContain('14 Oct 2026');
    expect(billing.planChange.blockedTitle('Starter', '14 Oct 2026')).toContain('14 Oct 2026');
    expect(billing.planChange.blockedBody('Pro', 'Starter', '14 Oct 2026')).toContain('14 Oct 2026');
    expect(billing.planChange.closeButton).toBeTruthy();
  });
});
