/**
 * The entitlement service — the single place that owns quota/expiry logic
 * for billing. NO Cashfree (or any payment provider) imports live here or
 * may ever be added here; Gate 3's webhook handler calls grantPlan()/
 * grantAddon() only after it has already verified a payment, and never the
 * other way around. This is what keeps the payment provider swappable.
 *
 * EFFECTIVE STATUS IS LAZY. The stored `status` column on Entitlement is
 * not trusted directly — validUntil/graceUntil are the source of truth, and
 * effectiveStatus() below derives TRIALING/ACTIVE -> GRACE -> EXPIRED from
 * them at read time. This is the same philosophy igIdentity.js's
 * hasActiveEntitlement() already used for trial expiry ("expired but the
 * sweeper has not run yet... treat as expired immediately"), extended to
 * the grace stage. A periodic sweep (Gate 4, successor to jobs/trialJob.js)
 * eventually writes the derived status back; nothing here depends on it
 * having run.
 *
 * A trial has NO grace stage: graceUntil is only ever set (validUntil + 3
 * days) for a paid plan grant, and stays NULL for TRIAL. effectiveStatus()
 * therefore falls straight through from TRIALING to EXPIRED for a trial,
 * without any TRIAL-specific branch.
 */

const prisma = require('../lib/prisma');
// Ops alerts only (see alertPlanAnomaly). Still no payment-provider import here.
const mailer = require('../lib/email');

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const LIVE_STATUSES = ['TRIALING', 'ACTIVE', 'GRACE'];

/** Plan row for a code, or null. Cached per-process would be premature — this table changes rarely and is tiny. */
async function getPlan(planCode) {
  if (!planCode) return null;
  return prisma.plan.findUnique({ where: { code: planCode } });
}

/**
 * Derive the status that actually governs behavior right now, independent
 * of whatever the stored `status` column says. See the module doc above.
 */
function effectiveStatus(entitlement, now = new Date()) {
  if (!entitlement || entitlement.status === 'NONE') return 'NONE';
  if (!entitlement.validUntil) return entitlement.status; // defensive; shouldn't occur once a trial/plan is granted
  if (now < entitlement.validUntil) return entitlement.status;
  if (entitlement.graceUntil && now < entitlement.graceUntil) return 'GRACE';
  return 'EXPIRED';
}

/**
 * The entitlement row for a tenant, augmented with the lazily-computed
 * effectiveStatus. Returns null for a tenant with no row at all (never
 * connected Instagram, never granted anything) — callers treat that the
 * same as NONE.
 */
async function getEntitlement(tenantId) {
  const entitlement = await prisma.entitlement.findUnique({ where: { userId: tenantId } });
  if (!entitlement) return null;
  return { ...entitlement, effectiveStatus: effectiveStatus(entitlement) };
}

/**
 * Why classification is or isn't allowed right now, as a reason code rather
 * than a bare boolean — 'hourly_throttle' is the one reason a caller should
 * NOT treat as a drop. It clears within the hour on its own, so a message
 * blocked only for this reason should be re-queued with a delay rather than
 * marked skipped; every other reason is durable until a plan/cycle change,
 * so retrying soon cannot help. Gate 4 is where messageAnalysisJob.js's
 * (currently disabled) gate is wired back up to consume this distinction —
 * this function exists now so that wiring has something to call.
 *
 * Continues through GRACE (per the brief: "on validUntil, stop auto-replies,
 * keep classification running") — only NONE/EXPIRED are 'not_entitled'.
 * The plan's cycle cap and hourly throttle are enforced in code but never
 * advertised as a number anywhere customer-facing (see
 * Plan.classificationCapCycle's schema comment).
 *
 * The hourly window is checked here but only ADVANCED by
 * recordClassification — this function never mutates state, so it is
 * always safe to call from a read path.
 *
 * @returns {'ok'|'not_entitled'|'cycle_cap'|'hourly_throttle'}
 */
async function classificationGateReason(tenantId) {
  const entitlement = await getEntitlement(tenantId);
  if (!entitlement || !LIVE_STATUSES.includes(entitlement.effectiveStatus)) return 'not_entitled';

  const plan = await getPlan(entitlement.planCode);
  if (!plan) return 'not_entitled'; // no plan on record — fail closed, same precedent as the old billingService

  if (plan.classificationCapCycle != null && entitlement.classificationCountCycle >= plan.classificationCapCycle) {
    return 'cycle_cap';
  }

  if (plan.classificationThrottlePerHour != null) {
    const now = Date.now();
    const withinWindow = now - entitlement.hourWindowStartedAt.getTime() < HOUR_MS;
    const effectiveHourCount = withinWindow ? entitlement.classificationCountHour : 0;
    if (effectiveHourCount >= plan.classificationThrottlePerHour) return 'hourly_throttle';
  }

  return 'ok';
}

/** May this tenant's inbound DMs be run through AI classification right now? Thin wrapper over classificationGateReason for callers that only need the boolean. */
async function canClassify(tenantId) {
  return (await classificationGateReason(tenantId)) === 'ok';
}

/**
 * Record ONE successful classification call for `messageId`, structurally
 * idempotent — not by convention.
 *
 * The CreditLedger row this writes (type CLASSIFY) is guarded by the
 * @@unique([tenantId, messageId, type]) constraint. A retried Gemini call,
 * or a Gemini->xAI->OpenAI failover, all resolve to the SAME messageId, so
 * the second and third attempt's insert collides (P2002) and is treated as
 * a no-op — the counters below are only incremented on the FIRST successful
 * insert for a given message. This also means reprocessing an old DM after
 * a model/prompt change costs the customer nothing: same messageId, same
 * no-op.
 *
 * Callers still only need to call this once per attempt that returns
 * successfully — the idempotency here is a structural backstop, not
 * permission to call it redundantly on purpose.
 *
 * The hourly window is a lazy sliding counter: if the last recorded window
 * has expired, this call both resets the window AND is the first count in
 * the new one — there is no separate "reset" step run by a cron.
 */
async function recordClassification(tenantId, messageId) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const entitlement = await tx.entitlement.findUnique({ where: { userId: tenantId } });
    const balanceAfter = entitlement ? entitlement.replyCreditsBanked + entitlement.replyCreditsCurrent : 0;

    try {
      await tx.creditLedger.create({
        data: { tenantId, messageId, delta: 0, type: 'CLASSIFY', source: 'classification', balanceAfter },
      });
    } catch (err) {
      if (err.code === 'P2002') return; // already recorded for this message — no-op, not an error
      throw err;
    }

    if (!entitlement) return;

    const withinWindow = now.getTime() - entitlement.hourWindowStartedAt.getTime() < HOUR_MS;

    await tx.entitlement.update({
      where: { userId: tenantId },
      data: {
        classificationCountCycle: { increment: 1 },
        classificationCountHour: withinWindow ? { increment: 1 } : 1,
        hourWindowStartedAt: withinWindow ? undefined : now,
      },
    });
  });
}

/**
 * May this tenant's auto-reply pipeline actually send a DM right now?
 *
 * Unlike classification, GRACE does NOT allow this — the brief is explicit
 * that only classification continues into grace. TRIALING is allowed: a trial
 * is granted TRIAL_AUTO_REPLY_CREDITS (see igIdentity.js) precisely so it can
 * demonstrate the feature, and the credit check below is what stops it once
 * that small allowance is gone. No TRIAL-specific branch is needed here, and
 * adding one would be wrong — a trial that has bought nothing and a plan that
 * has spent everything are the same situation, and the balance says so.
 */
async function canAutoReply(tenantId) {
  const entitlement = await getEntitlement(tenantId);
  if (!entitlement) return false;
  if (!['TRIALING', 'ACTIVE'].includes(entitlement.effectiveStatus)) return false;
  return entitlement.replyCreditsBanked + entitlement.replyCreditsCurrent > 0;
}

/**
 * Spend exactly one reply credit, FIFO — banked (older) drains before
 * current (newer). Atomic: a conditional read-modify-write inside a
 * transaction, so two concurrent auto-replies for the same tenant (across
 * different conversations — messageAnalysisJob's own per-conversation claim
 * only serializes within one conversation) cannot both observe the same
 * pre-spend balance and both succeed past zero.
 *
 * Every spend is a CreditLedger row — this is the record shown to a
 * customer who disputes their usage, so it is written even for a spend
 * that empties the balance to exactly zero.
 */
async function spendReplyCredit(tenantId) {
  return prisma.$transaction(async (tx) => {
    const entitlement = await tx.entitlement.findUnique({ where: { userId: tenantId } });
    const total = entitlement ? entitlement.replyCreditsBanked + entitlement.replyCreditsCurrent : 0;
    if (total <= 0) return { ok: false };

    const spendFromBanked = Math.min(1, entitlement.replyCreditsBanked);
    const spendFromCurrent = 1 - spendFromBanked;

    const updated = await tx.entitlement.update({
      where: { userId: tenantId },
      data: {
        replyCreditsBanked: { decrement: spendFromBanked },
        replyCreditsCurrent: { decrement: spendFromCurrent },
      },
    });

    const balanceAfter = updated.replyCreditsBanked + updated.replyCreditsCurrent;
    await tx.creditLedger.create({
      data: { tenantId, delta: -1, type: 'SPEND', source: 'auto_reply_spend', balanceAfter },
    });

    return { ok: true, balanceAfter };
  });
}

/**
 * How much of the ending cycle's unspent credit pool survives into the next
 * one, capped at the plan's bank cap. Shared by grantPlan's renewal path and
 * rollCycle below so the "excess is discarded at renewal" rule lives in
 * exactly one place.
 */
function computeBankRollover(entitlement, plan) {
  const bankCap = plan?.autoReplyBankCap ?? 0;
  const pool = entitlement.replyCreditsBanked + entitlement.replyCreditsCurrent;
  const banked = Math.min(pool, bankCap);
  return { banked, discarded: pool - banked };
}

/**
 * Purchasable tiers, lowest first. A plan's position is what makes a change an
 * upgrade or a downgrade. TRIAL is deliberately absent: it is not a paid tier,
 * so there is nothing to protect by blocking a move away from it.
 */
const PLAN_TIERS = Object.freeze({ STARTER: 1, PRO: 2, ENTERPRISE: 3 });

function tierOf(planCode) {
  return PLAN_TIERS[planCode] ?? 0;
}

/**
 * Must a purchase of `targetPlanCode` wait? Returns
 * { currentPlanCode, availableFrom } when it must, otherwise null.
 *
 * A downgrade is blocked only while a PAID plan is ACTIVE — i.e. before its
 * validUntil. Moving down then would cut short time the customer already paid
 * for at the higher tier (grantPlan switches the plan immediately), so the
 * switch opens on validUntil. In GRACE the paid period is already over, and a
 * trial is not a paid tier, so neither is blocked.
 *
 * The ONE copy of this rule: the checkout route enforces it and the billing
 * summary reports it, so the page can never offer a purchase the API refuses.
 */
function downgradeBlock(entitlement, targetPlanCode, now = new Date()) {
  if (!entitlement?.validUntil) return null;
  if (effectiveStatus(entitlement, now) !== 'ACTIVE') return null;
  const current = tierOf(entitlement.planCode);
  if (!current || tierOf(targetPlanCode) >= current) return null;
  return { currentPlanCode: entitlement.planCode, availableFrom: entitlement.validUntil };
}

/**
 * A downgrade was GRANTED while the customer's paid plan was still ACTIVE.
 *
 * Checkout refuses that purchase, so reaching grantPlan with it means an order
 * that pre-dates the block, or a path that bypassed checkout — and the money
 * has already been taken. Completing the grant is right (refusing would leave
 * a PAID order with nothing granted, which nothing retries), but a log line is
 * not enough: it goes to a human through the CRITICAL email tier, to
 * SUPPORT_EMAIL, the same path a reconciliation mismatch takes.
 *
 * Called AFTER the grant's transaction has committed, never inside it: an
 * alert about a grant that then rolled back would be its own false record.
 * Never throws — the grant has happened; a failed alert must not undo it or
 * surface as a failed webhook. If the email cannot go, the full detail is
 * logged as the fallback.
 */
async function alertPlanAnomaly(details) {
  console.error('[Entitlement] ANOMALY — downgrade granted during an active paid plan:', JSON.stringify(details));
  const to = (process.env.SUPPORT_EMAIL || '').trim();
  if (!to) {
    console.error('[Entitlement] SUPPORT_EMAIL is not set — the downgrade anomaly above reached no human.');
    return;
  }
  try {
    await mailer.sendBillingPlanAnomaly(to, details);
  } catch (err) {
    console.error('[Entitlement] Failed to send the downgrade anomaly alert — detail logged above:', err.message);
  }
}

/**
 * Grant a plan — a first purchase OR a renewal, both go through here.
 * tenantId, planCode ('STARTER' | 'PRO' | 'ENTERPRISE' — never 'TRIAL',
 * which is granted only by igIdentity.claimInstagramIdentity), and
 * region = { billingRegion, currency, regionSource } as resolved by
 * billingFulfillment.js from the Cashfree webhook's payment evidence.
 *
 * RENEWAL DATE MATH — "renewing early always extends from validUntil,
 * never from today": true for anyone still TRIALING/ACTIVE/GRACE
 * (effectiveStatus), because validUntil (and, for a grace renewal, the
 * original validUntil it was already carrying) is still the right anchor.
 * Anyone else — no row yet, or fully EXPIRED past grace — is a cold start
 * and gets a fresh cycle from now.
 *
 * CREDIT BANK — one rule for every warm grant (renewal, upgrade, or a change
 * reached in grace): the existing balance carries into the bank, capped at the
 * LARGER of the old and new plan's bank caps, and the new cycle's credits are
 * granted on top. Where two caps could apply, the customer's side wins: a
 * same-plan renewal and an upgrade are unaffected (the new cap is equal or
 * larger), and a downgrade keeps what was paid for under the old plan until
 * the next cycle roll or renewal caps it to the new plan. A cold start
 * forfeits whatever was left, per "after grace: credit bank is zeroed".
 *
 * A DOWNGRADE DURING AN ACTIVE PAID PLAN still completes (the money is taken),
 * and raises a CRITICAL alert to SUPPORT_EMAIL once committed — see
 * alertPlanAnomaly.
 *
 * NOTHING IS LOST WITHOUT A RECORD. Whatever does not survive — the excess
 * over the cap, or a cold start's forfeited balance — is written as an EXPIRE
 * row whose `source` names the reason, BEFORE the GRANT row. This used to be
 * silent: the carried bank was capped at the OLD plan's cap and the excess
 * simply vanished (517 credits on a Pro -> Starter sequence), which left the
 * ledger unable to answer a disputed balance. tests/ledger-invariant.test.js
 * pins "ledger sum === held balance" after every operation, and
 * billing:doctor checks the same against the live database.
 *
 * REGION LOCK — billingRegion/currency/regionSource are set ONLY when
 * there was no existing lock (existing?.billingRegion is null/undefined).
 * A renewal NEVER overwrites an already-locked region, even if `region`
 * here reports something different — that is what makes the lock a lock.
 * `region.billingRegion` is null for an UNVERIFIED payment (see
 * billingFulfillment.js), so `existing?.x || region.x` correctly leaves an
 * unlocked tenant unlocked (null || null = null) rather than ever locking
 * from weak/absent evidence — the plan is still granted normally either way.
 */
async function grantPlan(tenantId, planCode, region) {
  const plan = await getPlan(planCode);
  if (!plan) throw new Error(`entitlementService.grantPlan: unknown plan code "${planCode}"`);

  let anomaly = null; // set inside the transaction, alerted after it commits

  const granted = await prisma.$transaction(async (tx) => {
    const existing = await tx.entitlement.findUnique({ where: { userId: tenantId } });
    const now = new Date();
    const isWarmRenewal = Boolean(existing && LIVE_STATUSES.includes(effectiveStatus(existing, now)) && existing.validUntil);

    const cycleStart = isWarmRenewal ? existing.validUntil : now;
    const validUntil = new Date(cycleStart.getTime() + plan.cycleLengthDays * 24 * 60 * 60 * 1000);
    const graceUntil = planCode === 'TRIAL' ? null : new Date(validUntil.getTime() + GRACE_PERIOD_MS);

    const billingRegion = existing?.billingRegion || region.billingRegion;
    const currency = existing?.currency || region.currency;
    const regionSource = existing?.regionSource || region.regionSource;

    const priorBalance = existing ? existing.replyCreditsBanked + existing.replyCreditsCurrent : 0;
    let carriedBank = 0;
    let discard = null; // { amount, reason } — written as an EXPIRE row below

    if (isWarmRenewal) {
      // WHERE TWO CAPS COULD APPLY, FAVOUR THE CUSTOMER. The carried balance is
      // capped at the LARGER of the old and new plan's bank caps. A same-plan
      // renewal and an upgrade are unaffected (the new cap is equal or larger).
      // A downgrade keeps what was paid for under the old plan; the next cycle
      // roll or renewal caps it to the new plan in the normal way.
      const oldPlan = existing.planCode === planCode ? plan : await getPlan(existing.planCode);
      const carryCap = Math.max(plan.autoReplyBankCap ?? 0, oldPlan?.autoReplyBankCap ?? 0);
      carriedBank = Math.min(priorBalance, carryCap);
      if (priorBalance > carriedBank) {
        discard = {
          amount: priorBalance - carriedBank,
          reason: existing.planCode === planCode ? 'expire:renewal_bank_cap' : 'expire:plan_change_bank_cap',
        };
      }
      if (downgradeBlock(existing, planCode, now)) {
        // Checkout refuses this purchase, so reaching it means an order that
        // pre-dates the block, or a caller that bypassed checkout. The money is
        // already taken, so the grant proceeds — and a human is told once it
        // has committed.
        anomaly = {
          tenantId,
          fromPlanCode: existing.planCode,
          toPlanCode: planCode,
          paidUntil: existing.validUntil,
          carriedBalance: carriedBank,
          discarded: discard ? discard.amount : 0,
        };
      }
    } else if (priorBalance > 0) {
      discard = { amount: priorBalance, reason: 'expire:cold_start_forfeit' };
    }

    const grantCredits = plan.autoReplyCreditsPerCycle ?? 0;
    const extraIgAccounts = isWarmRenewal ? existing.extraIgAccounts : 0;

    const shared = {
      planCode,
      billingRegion,
      currency,
      regionSource,
      status: 'ACTIVE',
      validUntil,
      graceUntil,
      cycleStartedAt: now,
      replyCreditsCurrent: grantCredits,
      replyCreditsBanked: carriedBank,
      classificationCountCycle: 0,
      extraIgAccounts,
    };

    const updated = await tx.entitlement.upsert({
      where: { userId: tenantId },
      create: { userId: tenantId, ...shared },
      update: shared,
    });

    if (discard) {
      await tx.creditLedger.create({
        data: {
          tenantId,
          delta: -discard.amount,
          type: 'EXPIRE',
          source: discard.reason,
          balanceAfter: priorBalance - discard.amount,
        },
      });
    }

    await tx.creditLedger.create({
      data: {
        tenantId,
        delta: grantCredits,
        type: 'GRANT',
        source: `plan_grant:${planCode.toLowerCase()}`,
        balanceAfter: updated.replyCreditsBanked + updated.replyCreditsCurrent,
      },
    });

    return updated;
  });

  if (anomaly) await alertPlanAnomaly({ ...anomaly, newValidUntil: granted.validUntil });
  return granted;
}

/**
 * Grant an add-on. Two distinct shapes, per the brief's instruction not to
 * merge them into one table:
 *   - a consumable AddonPack (e.g. "reply_credits_500") credits
 *     replyCreditsCurrent — it is spent via the same FIFO order as any
 *     other current-cycle credit, and is itself subject to the bank cap at
 *     the NEXT rollover like any other unspent credit.
 *   - the recurring extra-IG-account add-on has no per-unit code; it just
 *     increments Entitlement.extraIgAccounts by one.
 */
async function grantAddon(tenantId, addonCode) {
  if (addonCode === 'extra_ig_account') {
    return prisma.entitlement.update({
      where: { userId: tenantId },
      data: { extraIgAccounts: { increment: 1 } },
    });
  }

  const pack = await prisma.addonPack.findUnique({ where: { code: addonCode } });
  if (!pack) throw new Error(`entitlementService.grantAddon: unknown addon code "${addonCode}"`);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.entitlement.update({
      where: { userId: tenantId },
      data: { replyCreditsCurrent: { increment: pack.creditAmount } },
    });

    await tx.creditLedger.create({
      data: {
        tenantId,
        delta: pack.creditAmount,
        type: 'GRANT',
        source: `addon:${addonCode}`,
        balanceAfter: updated.replyCreditsBanked + updated.replyCreditsCurrent,
      },
    });

    return updated;
  });
}

/**
 * Roll a tenant's cycle WITHOUT a renewal — the periodic (Gate 4) sweep's
 * equivalent of what grantPlan does inline for a renewal: fold the ending
 * cycle's unspent pool into the bank (capped, excess discarded via
 * CreditLedger EXPIRE) and reset the classification burst guard.
 *
 * NOT responsible for the ACTIVE -> GRACE -> EXPIRED status transition —
 * that is derived lazily by effectiveStatus() everywhere it matters
 * (canClassify, canAutoReply, grantPlan), so nothing here needs to run for
 * those checks to be correct. This function only exists for the numbers
 * that DO need an actual write: the bank cap and the classification count,
 * neither of which resets itself just because time passed.
 */
async function rollCycle(tenantId) {
  return prisma.$transaction(async (tx) => {
    const entitlement = await tx.entitlement.findUnique({ where: { userId: tenantId } });
    if (!entitlement) return null;

    const plan = await getPlan(entitlement.planCode);
    const { banked, discarded } = computeBankRollover(entitlement, plan);

    const updated = await tx.entitlement.update({
      where: { userId: tenantId },
      data: {
        replyCreditsBanked: banked,
        replyCreditsCurrent: 0,
        classificationCountCycle: 0,
        cycleStartedAt: new Date(),
      },
    });

    await tx.creditLedger.create({
      data: {
        tenantId,
        delta: -discarded,
        type: discarded > 0 ? 'EXPIRE' : 'ROLLOVER',
        // A discard names its reason; a pure rollover (nothing lost) keeps
        // the neutral source.
        source: discarded > 0 ? 'expire:cycle_bank_cap' : 'cycle_rollover',
        balanceAfter: updated.replyCreditsBanked + updated.replyCreditsCurrent,
      },
    });

    return updated;
  });
}

module.exports = {
  GRACE_PERIOD_MS,
  // Exported because routes/billing.js needs the SAME list to tell a
  // customer the date their renewal will actually land on. A second copy
  // that drifted would make the billing page promise a date grantPlan()
  // does not produce.
  LIVE_STATUSES,
  PLAN_TIERS,
  downgradeBlock,
  effectiveStatus,
  getEntitlement,
  canClassify,
  classificationGateReason,
  recordClassification,
  canAutoReply,
  spendReplyCredit,
  grantPlan,
  grantAddon,
  rollCycle,
};
