/**
 * One "API instance" for tests/scheduler-race.test.js, as its own Node process
 * with its own Prisma client and its own lock pool — exactly what a second
 * instance is. Waits until START_AT (so both racers call in the same
 * millisecond), then runs the production runIfDue() for JOB_NAME.
 *
 * The job body records which racer ran it and holds for HOLD_MS, so the other
 * racer arrives while it is still running.
 */

const { runIfDue, closeLockPool } = require('../../src/jobs/scheduler');
const prisma = require('../../src/lib/prisma');

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

(async () => {
  const name = process.env.RACER_NAME;
  await sleep(Number(process.env.START_AT) - Date.now());
  let outcome;
  try {
    outcome = await runIfDue(process.env.JOB_NAME, Number(process.env.INTERVAL_MS), async () => {
      await sleep(Number(process.env.HOLD_MS || 0));
      return { racer: name === 'A' ? 1 : 2 };
    });
  } catch (err) {
    outcome = { ran: false, reason: `error: ${err.message}` };
  }
  process.send({ name, ran: outcome.ran, reason: outcome.reason || null });
  await closeLockPool();
  await prisma.$disconnect();
  process.exit(0);
})();
