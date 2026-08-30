import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/setup/global-setup.mjs'],
    setupFiles: ['./tests/setup/env.js'],
    include: ['tests/**/*.test.js'],
    // SQLite is a single-writer database. Running test FILES in parallel
    // produces spurious SQLITE_BUSY failures that look like product bugs.
    // Tests *within* a file still run concurrently where they ask to — which
    // is what the auto-reply concurrency test needs.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
