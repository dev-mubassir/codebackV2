/**
 * Background job queue abstraction.
 *
 * Production target: Redis + BullMQ + Node worker(s), enabled automatically
 * whenever REDIS_URL is configured — with retries, backoff, concurrency
 * limits, and job status tracking built in via BullMQ.
 *
 * Local/dev fallback: when REDIS_URL is NOT configured, Codeback falls back
 * to a tiny in-process async queue with the *same* add()/registerProcessor()
 * interface (also with retries + exponential backoff + concurrency limits).
 * This means the webhook and every caller never talk to Redis or BullMQ
 * directly — they only depend on this module, so flipping on real Redis in
 * production is a config change, not a code change.
 *
 * This module intentionally never throws on missing Redis: AI processing is
 * best-effort background work and must never take messaging down (see
 * services/aiService.js + routes/webhook.js).
 */

const { isRedisConfigured, createRedisConnection } = require('./redis');

const registry = new Map(); // queueName -> job system instance

// How long an in-process jobId is remembered for dedupe, and how many at most.
// Duplicates this guards against arrive within seconds (Meta retrying a
// webhook); remembering forever was a slow leak — one entry per message ever.
const SEEN_JOB_TTL_MS = 6 * 60 * 60 * 1000;
const SEEN_JOB_MAX = 10000;

/**
 * Minimal in-process queue: FIFO with bounded concurrency and exponential
 * backoff retries. Good enough for single-instance deployments / local dev.
 * State is in-memory only (jobs are lost on process restart, matching the
 * "best effort" nature of async AI enrichment — the source-of-truth message
 * data is already persisted in Postgres/SQLite before a job is ever queued).
 */
class InMemoryJobQueue {
  constructor(name, { concurrency = 3 } = {}) {
    this.name = name;
    this.concurrency = concurrency;
    this._pending = [];
    this._active = 0;
    this._processor = null;
    this._seenJobIds = new Map(); // jobId -> first-seen ms, insertion-ordered
  }

  /** Drop remembered jobIds past their TTL, and the oldest beyond the cap. */
  _forgetOldJobIds(now) {
    for (const [id, seenAt] of this._seenJobIds) {
      if (now - seenAt < SEEN_JOB_TTL_MS && this._seenJobIds.size <= SEEN_JOB_MAX) break;
      this._seenJobIds.delete(id);
    }
  }

  setProcessor(fn, { concurrency } = {}) {
    this._processor = fn;
    if (concurrency) this.concurrency = concurrency;
    this._drain();
  }

  add(jobName, data, opts = {}) {
    const jobId = opts.jobId || `${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Idempotency: if a caller reuses the same jobId, don't enqueue twice.
    //
    // NOTE for delayed re-enqueues: a jobId is remembered for
    // SEEN_JOB_TTL_MS, so a caller that wants the SAME logical work to run
    // again sooner must vary the jobId (see jobs/index.js's throttle requeue,
    // which suffixes the attempt number). Re-adding a remembered jobId is
    // silently dropped, which would otherwise lose the message entirely.
    const now = Date.now();
    this._forgetOldJobIds(now);
    if (opts.jobId && this._seenJobIds.has(opts.jobId)) {
      return Promise.resolve({ id: jobId, deduped: true });
    }
    if (opts.jobId) this._seenJobIds.set(opts.jobId, now);

    const job = {
      id: jobId,
      name: jobName,
      data,
      attemptsMade: 0,
      maxAttempts: opts.attempts || 3,
      backoffMs: opts.backoffMs || 3000,
    };

    // delayMs defers the FIRST run (distinct from backoffMs, which spaces
    // out retries after a failure). Held in a timer, so it does not survive
    // a restart — same best-effort property the rest of this queue already
    // has when REDIS_URL is unset.
    if (opts.delayMs > 0) {
      const timer = setTimeout(() => {
        this._pending.push(job);
        this._drain();
      }, opts.delayMs);
      if (typeof timer.unref === 'function') timer.unref();
      return Promise.resolve({ id: jobId, delayed: true });
    }

    this._pending.push(job);
    setImmediate(() => this._drain());
    return Promise.resolve({ id: jobId });
  }

  _drain() {
    if (!this._processor) return;
    while (this._active < this.concurrency && this._pending.length > 0) {
      const job = this._pending.shift();
      this._active += 1;
      this._run(job);
    }
  }

  async _run(job) {
    try {
      await this._processor(job);
    } catch (err) {
      job.attemptsMade += 1;
      const willRetry = job.attemptsMade < job.maxAttempts;
      console.error(
        `[Queue:${this.name}] Job "${job.name}" failed (attempt ${job.attemptsMade}/${job.maxAttempts})` +
          `${willRetry ? ', will retry' : ', giving up'}:`,
        err.message
      );
      if (willRetry) {
        const delay = job.backoffMs * Math.pow(2, job.attemptsMade - 1);
        setTimeout(() => {
          this._pending.push(job);
          this._drain();
        }, delay);
      }
    } finally {
      this._active -= 1;
      this._drain();
    }
  }
}

function buildRedisJobSystem(name) {
  // Lazily required so environments without Redis configured never even
  // load ioredis/bullmq's connection machinery.
  const { Queue, Worker } = require('bullmq');

  const connection = createRedisConnection(`queue:${name}`, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });

  const queue = new Queue(name, { connection });
  const workers = [];

  return {
    mode: 'redis',
    async close() {
      // Workers first: close() waits for the jobs in flight, and anything not
      // finished is picked up again by another instance (BullMQ stalled-job
      // recovery), so a deploy never loses queued work.
      await Promise.all(workers.map((w) => w.close().catch(() => {})));
      await queue.close().catch(() => {});
    },
    add(jobName, data, opts = {}) {
      return queue.add(jobName, data, {
        attempts: opts.attempts || 3,
        backoff: { type: 'exponential', delay: opts.backoffMs || 3000 },
        removeOnComplete: 500,
        removeOnFail: 500,
        jobId: opts.jobId,
        // Defers the first run. BullMQ persists delayed jobs in Redis, so
        // unlike the in-process fallback these DO survive a restart.
        ...(opts.delayMs > 0 ? { delay: opts.delayMs } : {}),
      });
    },
    registerProcessor(processorFn, workerOpts = {}) {
      const worker = new Worker(
        name,
        async (job) => processorFn(job),
        { connection, concurrency: workerOpts.concurrency || 3 }
      );
      worker.on('failed', (job, err) => {
        // BullMQ fires this for EVERY failed attempt; say which one it was.
        const attempts = job?.opts?.attempts || 1;
        const final = (job?.attemptsMade || 0) >= attempts;
        console.error(
          `[Queue:${name}] Job "${job?.name}" failed (attempt ${job?.attemptsMade}/${attempts})` +
            `${final ? ', giving up' : ', will retry'}:`,
          err.message
        );
      });
      workers.push(worker);
      return worker;
    },
  };
}

function buildMemoryJobSystem(name, opts) {
  const q = new InMemoryJobQueue(name, opts);
  return {
    mode: 'memory',
    async close() {
      // Nothing to hand over: in-process jobs are best effort by design, and
      // the stalled-analysis sweep re-queues any message left unclassified.
    },
    add(jobName, data, addOpts) {
      return q.add(jobName, data, addOpts);
    },
    registerProcessor(processorFn, workerOpts = {}) {
      q.setProcessor(processorFn, workerOpts);
      return q;
    },
  };
}

/**
 * Get (or create) the named job system. Call once per queue name; the same
 * instance is reused for both producers (webhook route) and the consumer
 * (worker) since they run in the same Node process today.
 */
function getJobSystem(name, opts = {}) {
  if (registry.has(name)) return registry.get(name);

  let system;
  if (isRedisConfigured()) {
    try {
      system = buildRedisJobSystem(name);
      console.log(`[Queue:${name}] Using Redis/BullMQ backend.`);
    } catch (err) {
      console.warn(`[Queue:${name}] Failed to initialize Redis backend (${err.message}). Falling back to in-process queue.`);
      system = buildMemoryJobSystem(name, opts);
    }
  } else {
    system = buildMemoryJobSystem(name, opts);
    console.log(`[Queue:${name}] REDIS_URL not set — using in-process queue (fine for local dev / single instance).`);
  }

  registry.set(name, system);
  return system;
}

/** Close every queue (and its workers). For graceful shutdown. */
async function closeQueues() {
  const systems = [...registry.values()];
  registry.clear();
  await Promise.all(systems.map((system) => system.close()));
}

/** 'bullmq' | 'memory' for a queue that exists, else what one WOULD use. */
function queueDriver(name = 'ai-processing') {
  const system = registry.get(name);
  const mode = system ? system.mode : isRedisConfigured() ? 'redis' : 'memory';
  return mode === 'redis' ? 'bullmq' : 'memory';
}

module.exports = { getJobSystem, closeQueues, queueDriver, InMemoryJobQueue };
