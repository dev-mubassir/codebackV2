/**
 * Shared terminal helpers for the owner-run admin scripts
 * (create-admin.js, reset-admin-password.js).
 *
 * Two properties matter more than anything else here:
 *   - the password is read with echo OFF and never printed, logged, or passed
 *     on the command line (where shell history and `ps` would keep it);
 *   - nothing printed can contain the database URL — Prisma and pg error text
 *     is scrubbed of anything that looks like a connection string.
 */

const readline = require('readline');

const MIN_LENGTH = 16;
const MAX_LENGTH = 1024;

function scrub(text) {
  return String(text || '')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[database url hidden]')
    .replace(/password=\S+/gi, 'password=[hidden]');
}

function fail(message) {
  console.error(`\nERROR: ${scrub(message)}`);
  process.exit(1);
}

function requireTty() {
  if (!process.stdin.isTTY) {
    fail('This script must be run in an interactive terminal (it reads the password with echo off).');
  }
}

function promptVisible(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Read one line with echo off. Handles paste, backspace and Ctrl+C. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      resolve(value);
    };
    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish();
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\nCancelled.\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
      return undefined;
    }
    stdin.on('data', onData);
  });
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail('That is not a valid email address.');
  return email;
}

/** Ask twice, enforce the length rule, never echo. */
async function promptNewPassword() {
  const first = await promptHidden(`New admin password (at least ${MIN_LENGTH} characters, hidden): `);
  if (first.length < MIN_LENGTH) fail(`The password must be at least ${MIN_LENGTH} characters.`);
  if (first.length > MAX_LENGTH) fail(`The password must be at most ${MAX_LENGTH} characters.`);
  if (first.trim() !== first) fail('The password must not start or end with a space.');
  const second = await promptHidden('Repeat the password: ');
  if (first !== second) fail('The two passwords do not match. Nothing was changed.');
  return first;
}

module.exports = { MIN_LENGTH, scrub, fail, requireTty, promptVisible, promptHidden, normalizeEmail, promptNewPassword };
