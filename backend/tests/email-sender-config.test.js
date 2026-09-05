/**
 * onboarding@resend.dev must never become production config.
 *
 * WHY THIS TEST EXISTS. That address is Resend's onboarding sender: it works
 * with NO domain verification, which makes it a perfect diagnostic — and a
 * trap. It only delivers to the Resend account owner's own address, so if it
 * ever became the FROM_EMAIL default or a fallback, sending would appear to
 * work in every local test while silently reaching nobody else. Every customer
 * password reset would vanish, and the logs would say "sent".
 *
 * It was used deliberately and temporarily to prove the reset loop end to end
 * before the real domain was verified. This test is the guard that stops that
 * temporary state from quietly becoming permanent.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, '..');

const DIAGNOSTIC_SENDER = 'onboarding@resend.dev';

/** Every .js file under a directory, skipping node_modules. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(full);
  }
  return out;
}

describe('the diagnostic sender must never be production config', () => {
  it('does not appear anywhere in src/', () => {
    const offenders = [];
    for (const file of walk(join(BACKEND, 'src'))) {
      const contents = readFileSync(file, 'utf8');
      if (contents.includes(DIAGNOSTIC_SENDER)) offenders.push(file);
    }

    expect(
      offenders,
      `${DIAGNOSTIC_SENDER} only delivers to the Resend account owner. As a default or ` +
        `fallback it would make sending LOOK fine locally while every real customer's ` +
        `password reset silently reached nobody. Found in: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('is not the FROM_EMAIL fallback when the env var is unset', () => {
    const previous = process.env.FROM_EMAIL;
    delete process.env.FROM_EMAIL;

    try {
      // Re-require with a clean module cache so the fallback is re-evaluated.
      const modulePath = require.resolve('../src/lib/email/index.js');
      delete require.cache[modulePath];
      require(modulePath);

      const source = readFileSync(join(BACKEND, 'src', 'lib', 'email', 'index.js'), 'utf8');
      const fallbackLine = source
        .split('\n')
        .find((l) => l.includes('FROM_EMAIL') && l.includes('||'));

      expect(fallbackLine, 'lib/email should declare a FROM_EMAIL fallback').toBeTruthy();
      expect(
        fallbackLine,
        'the fallback must be a real sending address on a domain we control'
      ).not.toContain(DIAGNOSTIC_SENDER);
    } finally {
      if (previous === undefined) delete process.env.FROM_EMAIL;
      else process.env.FROM_EMAIL = previous;
    }
  });

  it('is not committed in .env.example', () => {
    let example = '';
    try {
      example = readFileSync(join(BACKEND, '..', '.env.example'), 'utf8');
    } catch {
      return; // absent is fine
    }
    expect(example).not.toContain(DIAGNOSTIC_SENDER);
  });

  it('the module binding is never named `email`, so req.body cannot shadow it', () => {
    // The register handler destructures `const { name, email, password } =
    // req.body`, which shadowed a module imported as `email`. The send then
    // threw, was caught by a log-only handler, and registration silently never
    // sent a verification email in any environment.
    const offenders = [];
    for (const file of walk(join(BACKEND, 'src'))) {
      const contents = readFileSync(file, 'utf8');
      if (/const\s+email\s*=\s*require\(['"][^'"]*lib\/email['"]\)/.test(contents)) {
        offenders.push(file);
      }
    }

    expect(
      offenders,
      'bind the mail module as `mailer`. `email` is far too likely a local ' +
        `variable name in auth code, and the collision is silent. Found in: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});

describe('undeliverable recipients can never reach a real provider', () => {
  const mailer = require('../src/lib/email/index.js');

  it('reserved and fixture domains are refused', () => {
    for (const addr of [
      'someone@test.codeback',
      'a@foo.test',
      'b@example.com',
      'c@thing.invalid',
      'd@my.localhost',
    ]) {
      expect(mailer.isUndeliverable(addr), `${addr} must be refused`).toBe(true);
    }
  });

  it('real addresses are NOT refused', () => {
    for (const addr of ['real@gmail.com', 'user@siffty.com', 'x@mail.siffty.com']) {
      expect(mailer.isUndeliverable(addr), `${addr} must be allowed`).toBe(false);
    }
  });

  it('THE REGRESSION: the guard is on the RECIPIENT, not on NODE_ENV', () => {
    // A NODE_ENV=test check covers the vitest suite only. It did NOT cover
    // scripts/walkthrough.js, which drives a real server in development mode
    // with a live key — and that sent two emails to @test.codeback that
    // bounced. Checking the recipient is what makes the guard hold for every
    // caller: walkthrough, seed scripts, backfills and background jobs.
    const source = readFileSync(join(BACKEND, 'src', 'lib', 'email', 'index.js'), 'utf8');
    expect(source).toContain('isUndeliverable');
    const guardLine = source
      .split('\n')
      .find((l) => l.includes('isUndeliverable(to)'));
    expect(guardLine, 'deliver() must consult the recipient guard').toBeTruthy();
  });
});
