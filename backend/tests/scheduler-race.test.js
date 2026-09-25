/**
 * The multi-instance scheduler (src/jobs/scheduler.js): due-check + Postgres
 * advisory lock.
 *
 * The race test runs two SEPARATE Node processes — two Prisma clients, two
 * lock pools, two Postgres sessions — that call runIfDue() for the same job
 * in the same millisecond. Exactly one may run it; job_runs must show one run.
 * That is the production guarantee with N API instances.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma, resetDb, uniq } from './helpers/db.js';

const require = createRequire(import.meta.url);
const scheduler = require('../src/jobs/scheduler.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const RACER = path.join(here, 'helpers', 'scheduler-racer.cjs');
const HOUR = 60 * 60 * 1000;

function race({ jobName, intervalMs = HOUR, holdMs = 1500 }) {
  const startAt = Date.now() + 1500; // both processes boot, then fire together
  return Promise.all(
    ['A', 'B'].map(
      (name) =>
        new Promise((resolve, reject) => {
          const child = fork(RACER, [], {
            env: { ...process.env, RACER_NAME: name, JOB_NAME: jobName, INTERVAL_MS: String(intervalMs), HOLD_MS: String(holdMs), START_AT: String(startAt) },
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
          });
          child.once('message', resolve);
          child.once('exit', (code) => code !== 0 && reject(new Error(`racer ${name} exited ${code}`)));
        })
    )
  );
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await scheduler.closeLockPool();
  await prisma.$disconnect();
});

describe('scheduler: two instances race for one job', () => {
  it('exactly one process runs it; the other is turned away by the advisory lock', async () => {
    const jobName = uniq('race_job');
    const results = await race({ jobName });

    const ran = results.filter((r) => r.ran);
    expect(ran, JSON.stringify(results)).toHaveLength(1);
    const loser = results.find((r) => !r.ran);
    // Arrived while the winner held the lock ('locked'), or just after it
    // finished and found the job already done ('not_due'). Never ran it.
    expect(['locked', 'not_due']).toContain(loser.reason);

    const runs = await prisma.jobRun.findMany({ where: { jobName } });
    expect(runs).toHaveLength(1);
    expect(runs[0].success).toBe(true);
  }, 30000);

  it('a racer arriving after the winner finished sees the job is not due (no boot re-run)', async () => {
    const jobName = uniq('race_job');
    await race({ jobName, holdMs: 0 });
    const again = await scheduler.runIfDue(jobName, HOUR, async () => 'should not run');
    expect(again).toEqual({ ran: false, reason: 'not_due' });
    expect(await prisma.jobRun.count({ where: { jobName } })).toBe(1);
  }, 30000);
});

describe('scheduler: due-check', () => {
  const jobName = 'due_check_job';

  it('never run -> due', async () => {
    expect(await scheduler.isDue(jobName, HOUR)).toBe(true);
  });

  it('last success at 50% of the interval -> not due; at 95% -> due', async () => {
    const now = Date.now();
    await prisma.jobRun.create({ data: { jobName, startedAt: new Date(now - 0.5 * HOUR), finishedAt: new Date(), success: true } });
    expect(await scheduler.isDue(jobName, HOUR, now)).toBe(false);
    expect(await scheduler.isDue(jobName, HOUR, now + 0.45 * HOUR)).toBe(true);
  });

  it('a failed run is retried after the retry delay, not a full interval later', async () => {
    const now = Date.now();
    const DAY = 24 * HOUR;
    await prisma.jobRun.create({ data: { jobName, startedAt: new Date(now - 2 * DAY), success: true, finishedAt: new Date(now - 2 * DAY) } });
    await prisma.jobRun.create({ data: { jobName, startedAt: new Date(now - 5 * 60 * 1000), success: false, finishedAt: new Date() } });
    expect(await scheduler.isDue(jobName, DAY, now), 'failed 5 min ago: wait').toBe(false);
    expect(await scheduler.isDue(jobName, DAY, now + 11 * 60 * 1000), 'failed 16 min ago: retry').toBe(true);
  });

  it('a job that throws is recorded as failed and the error reaches the caller', async () => {
    await expect(
      scheduler.runIfDue(uniq('failing_job'), HOUR, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    const failed = await prisma.jobRun.findFirst({ where: { success: false }, orderBy: { startedAt: 'desc' } });
    expect(failed.error).toBe('boom');
  });

  it('a job whose enabled() is false is skipped without a run record', async () => {
    const name = uniq('gated_job');
    const out = await scheduler.runIfDue(name, HOUR, async () => 'x', { enabled: () => false });
    expect(out).toEqual({ ran: false, reason: 'disabled' });
    expect(await prisma.jobRun.count({ where: { jobName: name } })).toBe(0);
  });

  it('RUN_IN_PROCESS_SCHEDULER=false switches the timers off; anything else leaves them on', () => {
    const before = process.env.RUN_IN_PROCESS_SCHEDULER;
    try {
      process.env.RUN_IN_PROCESS_SCHEDULER = 'false';
      expect(scheduler.schedulerEnabled()).toBe(false);
      process.env.RUN_IN_PROCESS_SCHEDULER = 'true';
      expect(scheduler.schedulerEnabled()).toBe(true);
      delete process.env.RUN_IN_PROCESS_SCHEDULER;
      expect(scheduler.schedulerEnabled()).toBe(true);
    } finally {
      process.env.RUN_IN_PROCESS_SCHEDULER = before;
    }
  });

  it('ticks: a sixth of the interval, at least a minute, never more than the interval', () => {
    expect(scheduler.tickMs(5 * 60 * 1000)).toBe(60 * 1000);
    expect(scheduler.tickMs(HOUR)).toBe(10 * 60 * 1000);
    expect(scheduler.tickMs(24 * HOUR)).toBe(4 * HOUR);
    expect(scheduler.tickMs(30 * 1000)).toBe(30 * 1000);
  });
});
