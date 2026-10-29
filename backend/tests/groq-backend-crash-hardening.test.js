/**
 * Regression Test Suite: Crash Prevention & Hardening for Groq / AI Usage
 *
 * Verifies that the backend boots, serves traffic, and handles DMs gracefully even when:
 * 1. The `ai_usage_logs` table does not exist in the database yet (decoupled migration).
 * 2. `migrationGuard` encounters pending non-critical additive migrations (warns, does not exit 1).
 * 3. `GROQ_API_KEY` is not set (warns once, marks Groq unavailable, falls back cleanly to Gemini).
 * 4. The `text_generation_provider` setting row does not exist (falls back cleanly).
 * 5. Admin usage queries return `migrationPending: true` and empty data instead of 500 errors.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'node:module';
import express from 'express';

import { prisma, resetDb, createUser, createAdminUser } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';

const require = createRequire(import.meta.url);
const migrationGuard = require('../src/lib/migrationGuard.js');
const aiUsageLogger = require('../src/lib/ai/aiUsageLogger.js');
const groqTextGen = require('../src/lib/ai/groqTextGen.js');
const { publicHealthHandler } = require('../src/lib/health.js');
const adminAiUsageRouter = require('../src/routes/adminAiUsage.js');

describe('Groq Backend Crash Hardening & Graceful Degradation', () => {
  let tableRenamed = false;

  beforeAll(async () => {
    // Temporarily hide the ai_usage_logs table to simulate the DB being behind the code
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "ai_usage_logs" RENAME TO "ai_usage_logs_temp_hidden"`);
      tableRenamed = true;
    } catch (err) {
      // Table may not exist or already renamed
      tableRenamed = false;
    }
  });

  afterAll(async () => {
    // Restore the ai_usage_logs table
    if (tableRenamed) {
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "ai_usage_logs_temp_hidden" RENAME TO "ai_usage_logs"`);
      } catch (err) {
        // Table restore fallback
      }
    }
    // Re-ensure migration row exists for local DB integrity
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        VALUES ('20261029100000_add_ai_usage_logs', 'checksum', NOW(), '20261029100000_add_ai_usage_logs', '', NULL, NOW(), 1)
        ON CONFLICT (id) DO NOTHING
      `);
    } catch { }
  });

  beforeEach(() => {
    aiUsageLogger._clearMemoryBuffer();
    aiUsageLogger._resetWarnedTableMissing();
    groqTextGen._resetWarnedMissingKey();
    groqTextGen.clearTextProviderOverrideCache();
  });

  it('1. migrationGuard permits boot when only non-critical migrations are missing', async () => {
    // Simulate migration record missing in _prisma_migrations
    await prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029100000_add_ai_usage_logs'`);

    const result = await migrationGuard.checkMigrations();
    expect(result.missing).toContain('20261029100000_add_ai_usage_logs');
    expect(result.criticalMissing).toHaveLength(0);
    expect(result.nonCriticalMissing).toContain('20261029100000_add_ai_usage_logs');
    expect(result.ok).toBe(true);

    // assertMigrationsCurrent must NOT exit with code 1
    let exitCalledWith = null;
    const origExit = process.exit;
    process.exit = (code) => {
      exitCalledWith = code;
    };

    try {
      await migrationGuard.assertMigrationsCurrent();
    } finally {
      process.exit = origExit;
    }

    expect(exitCalledWith, 'assertMigrationsCurrent must not call process.exit(1) for additive migrations').toBeNull();
  });

  it('2. GET /health returns 200 OK even when ai_usage_logs table is missing', async () => {
    const app = express();
    app.get('/health', publicHealthHandler);

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('3. Simulated DM flow succeeds via Gemini fallback and logger fails open without throwing', async () => {
    const savedGroqKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    let geminiCalled = false;
    const mockGeminiFallback = async () => {
      geminiCalled = true;
      return {
        text: 'Thank you for your message! We will reply shortly.',
        model: 'gemini-flash-lite-latest',
        provider: 'gemini',
        usage: { input: 15, output: 10 },
      };
    };

    const output = await groqTextGen.generateTextWithGroqOrFallback({
      prompt: 'Customer says: What are your opening hours?',
      feature: 'auto_reply',
      userId: 'test-user-123',
      tenantId: 'test-tenant-123',
      fallbackFn: mockGeminiFallback,
    });

    expect(geminiCalled).toBe(true);
    expect(output.text).toBe('Thank you for your message! We will reply shortly.');
    expect(output.provider).toBe('gemini');
    expect(output.isFallback).toBe(true);
    expect(output.fallbackReason).toBe('missing_key');

    // Allow the asynchronous fire-and-forget log to reject and buffer
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify logger buffered row without throwing
    const buffer = aiUsageLogger._getMemoryBuffer();
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0].feature).toBe('auto_reply');

    // Restore env
    if (savedGroqKey) process.env.GROQ_API_KEY = savedGroqKey;
  });

  it('4. GROQ_API_KEY missing logs a warning once and marks Groq unconfigured', async () => {
    const savedGroqKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

    expect(groqTextGen.isGroqConfigured()).toBe(false);

    const stats = groqTextGen.getGroqTextGenStats();
    expect(stats.isConfigured).toBe(false);

    // Call fallback twice
    const dummyFallback = async () => ({ text: 'OK', provider: 'gemini', model: 'gemini' });
    await groqTextGen.generateTextWithGroqOrFallback({ prompt: 'test 1', fallbackFn: dummyFallback });
    await groqTextGen.generateTextWithGroqOrFallback({ prompt: 'test 2', fallbackFn: dummyFallback });

    // Ensure warning was logged exactly once
    const missingKeyWarnings = warnSpy.mock.calls.filter((call) =>
      call[0] && typeof call[0] === 'string' && call[0].includes('GROQ_API_KEY is not set')
    );
    expect(missingKeyWarnings).toHaveLength(1);

    warnSpy.mockRestore();
    if (savedGroqKey) process.env.GROQ_API_KEY = savedGroqKey;
  });

  it('5. Admin usage endpoints return migrationPending: true and empty data instead of 500', async () => {
    const adminApp = express();
    adminApp.use(express.json());
    adminApp.use('/api/admin', adminAiUsageRouter);

    // Summary endpoint
    const resSummary = await request(adminApp).get('/api/admin/ai/usage/summary');
    expect(resSummary.status).toBe(200);
    expect(resSummary.body.migrationPending).toBe(true);
    expect(resSummary.body.requests).toBe(0);

    // Breakdown endpoint
    const resBreakdown = await request(adminApp).get('/api/admin/ai/usage/breakdown');
    expect(resBreakdown.status).toBe(200);
    expect(resBreakdown.body.migrationPending).toBe(true);
    expect(resBreakdown.body.models).toEqual([]);

    // Users endpoint
    const resUsers = await request(adminApp).get('/api/admin/ai/usage/users');
    expect(resUsers.status).toBe(200);
    expect(resUsers.body.migrationPending).toBe(true);
    expect(resUsers.body.users).toEqual([]);

    // Traces endpoint
    const resTraces = await request(adminApp).get('/api/admin/ai/usage/traces');
    expect(resTraces.status).toBe(200);
    expect(resTraces.body.migrationPending).toBe(true);
    expect(resTraces.body.traces).toEqual([]);

    // Export endpoint
    const resExport = await request(adminApp).get('/api/admin/ai/usage/export');
    expect(resExport.status).toBe(200);
    expect(resExport.headers['content-type']).toContain('text/csv');
    expect(resExport.text).toContain('id,created_at,user_id,tenant_id,feature,provider,model');
  });
});
