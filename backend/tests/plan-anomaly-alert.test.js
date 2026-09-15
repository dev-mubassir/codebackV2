/**
 * A downgrade that reaches grantPlan while the paid plan is still ACTIVE.
 *
 * Checkout refuses that purchase (plan-downgrade-block.test.js), so reaching
 * grantPlan with it means an order that pre-dates the block or a path that
 * bypassed checkout — and the money is already taken. The grant completes
 * (refusing would strand a PAID order with nothing granted), and the anomaly
 * goes to a human: a CRITICAL-tier email to SUPPORT_EMAIL, sent only after the
 * grant has committed, and never able to undo it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

import { prisma, resetDb, createUser } from './helpers/db.js';

const require = createRequire(import.meta.url);
const svc = require('../src/services/entitlementService.js');
const mailer = require('../src/lib/email/index.js');
const quota = require('../src/lib/email/quota.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const REGION = { billingRegion: 'IN', currency: 'INR', regionSource: 'RAIL_INFERRED' };
const SUPPORT = 'ops@test.codeback';
const originalSupport = process.env.SUPPORT_EMAIL;

let alert;

beforeEach(async () => {
  await resetDb();
  for (const [code, name, rc, bank] of [['STARTER', 'Starter', 500, 500], ['PRO', 'Pro', 2000, 2000]]) {
    const data = { name, igAccountLimit: 1, autoReplyCreditsPerCycle: rc, autoReplyBankCap: bank, cycleLengthDays: 30, isActive: true };
    await prisma.plan.upsert({ where: { code }, update: data, create: { code, ...data } });
  }
  process.env.SUPPORT_EMAIL = SUPPORT;
  alert = vi.spyOn(mailer, 'sendBillingPlanAnomaly').mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSupport === undefined) delete process.env.SUPPORT_EMAIL;
  else process.env.SUPPORT_EMAIL = originalSupport;
});

async function onActivePro() {
  const { user } = await createUser({ withTrial: false });
  const pro = await svc.grantPlan(user.id, 'PRO', REGION);
  return { tenantId: user.id, pro };
}

describe('a downgrade granted during an active paid plan', () => {
  it('completes, and alerts SUPPORT_EMAIL exactly once with the facts', async () => {
    const { tenantId, pro } = await onActivePro();

    const granted = await svc.grantPlan(tenantId, 'STARTER', REGION);

    expect(granted.planCode, 'the grant is not refused — the money was taken').toBe('STARTER');
    expect(alert).toHaveBeenCalledTimes(1);
    const [to, details] = alert.mock.calls[0];
    expect(to).toBe(SUPPORT);
    expect(details).toMatchObject({
      tenantId,
      fromPlanCode: 'PRO',
      toPlanCode: 'STARTER',
      carriedBalance: 2000, // capped at the LARGER of the two caps: Pro's
      discarded: 0,
    });
    expect(new Date(details.paidUntil).getTime()).toBe(pro.validUntil.getTime());
    expect(new Date(details.newValidUntil).getTime()).toBe(granted.validUntil.getTime());
  });

  it('is sent on the CRITICAL email tier, same as a reconciliation mismatch', () => {
    expect(quota.CRITICAL_TYPES.has('billingPlanAnomaly')).toBe(true);
    expect(quota.CRITICAL_TYPES.has('billingReconciliationMismatch')).toBe(true);
  });

  it('goes out only after the grant has committed', async () => {
    const { tenantId } = await onActivePro();
    let planSeenByAlert = null;
    alert.mockImplementation(async () => {
      // A separate client: this only sees committed data.
      planSeenByAlert = (await prisma.entitlement.findUnique({ where: { userId: tenantId } })).planCode;
      return { ok: true };
    });

    await svc.grantPlan(tenantId, 'STARTER', REGION);
    expect(planSeenByAlert).toBe('STARTER');
  });

  it('a failed email neither undoes the grant nor fails the call', async () => {
    const { tenantId } = await onActivePro();
    alert.mockRejectedValue(new Error('smtp unavailable'));

    await expect(svc.grantPlan(tenantId, 'STARTER', REGION)).resolves.toBeTruthy();
    expect((await prisma.entitlement.findUnique({ where: { userId: tenantId } })).planCode).toBe('STARTER');
  });

  it('with SUPPORT_EMAIL unset, the grant still completes and no send is attempted', async () => {
    const { tenantId } = await onActivePro();
    delete process.env.SUPPORT_EMAIL;

    const granted = await svc.grantPlan(tenantId, 'STARTER', REGION);
    expect(granted.planCode).toBe('STARTER');
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('no alert where nothing is anomalous', () => {
  it('an upgrade', async () => {
    const { user } = await createUser({ withTrial: false });
    await svc.grantPlan(user.id, 'STARTER', REGION);
    await svc.grantPlan(user.id, 'PRO', REGION);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a same-plan renewal', async () => {
    const { tenantId } = await onActivePro();
    await svc.grantPlan(tenantId, 'PRO', REGION);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a lower tier once the paid period is over (grace)', async () => {
    const { tenantId } = await onActivePro();
    await prisma.entitlement.update({
      where: { userId: tenantId },
      data: { validUntil: new Date(Date.now() - DAY_MS), graceUntil: new Date(Date.now() + 2 * DAY_MS) },
    });
    await svc.grantPlan(tenantId, 'STARTER', REGION);
    expect(alert).not.toHaveBeenCalled();
  });
});
