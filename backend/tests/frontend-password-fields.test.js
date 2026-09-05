/**
 * Password fields must be bound to the RIGHT input.
 *
 * WHY THIS EXISTS. A regex-driven refactor converted nine password inputs to a
 * shared <PasswordInput>. The pattern scanned FORWARD from `<input`, so a lazy
 * match happily spanned the PRECEDING field and swallowed two elements as one.
 * The result on /login and /register:
 *
 *   - the show/hide toggle was attached to the EMAIL field
 *   - and `type="password"` was stripped from the actual password field, which
 *     therefore defaulted to type="text" and rendered the password in
 *     cleartext
 *
 * The second half is the serious one and was not visible from the symptom.
 *
 * WHY NO TEST CAUGHT IT. The frontend has NO test coverage at all — no runner,
 * no dependencies, no test files. All existing tests are backend. So this was
 * not an isolation-versus-integration gap; there was simply nothing to fail.
 *
 * This file is a static check on the source, in the same style as
 * email-sender-config.test.js, so it runs with the existing suite and needs no
 * new frontend test infrastructure. It is a stopgap: real component tests would
 * be better, and the absence of a frontend runner is recorded in FINDINGS.md.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_APP = join(HERE, '..', '..', 'frontend', 'src', 'app');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Every <PasswordInput …/> and <input …/> block, with its own attributes. */
function extractFields(source) {
  const fields = [];
  const re = /<(PasswordInput|input)\b([\s\S]*?)\/>/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const [, tag, attrs] = m;
    // If a block contains another tag opener, the match spanned two elements —
    // exactly the bug this file exists to catch.
    if (/<(PasswordInput|input)\b/.test(attrs)) {
      fields.push({ tag, attrs, spansMultiple: true });
      continue;
    }
    fields.push({ tag, attrs, spansMultiple: false });
  }
  return fields;
}

const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
};

/** Does this field look like it holds a password? */
function looksLikePassword(attrs) {
  const id = (attr(attrs, 'id') || '').toLowerCase();
  const autoComplete = (attr(attrs, 'autoComplete') || '').toLowerCase();
  const value = (attrs.match(/value=\{([^}]*)\}/) || [, ''])[1].toLowerCase();
  return (
    id.includes('password') ||
    autoComplete.includes('password') ||
    value.includes('password')
  );
}

const files = walk(FRONTEND_APP);

describe('frontend: PasswordInput is bound to actual password fields', () => {
  it('THE BUG: no PasswordInput sits on an email, text or username field', () => {
    const offenders = [];
    for (const file of files) {
      for (const f of extractFields(readFileSync(file, 'utf8'))) {
        if (f.tag !== 'PasswordInput') continue;
        const type = attr(f.attrs, 'type');
        if (type && type !== 'password') {
          offenders.push(`${relative(FRONTEND_APP, file)} -> type="${type}"`);
        } else if (!looksLikePassword(f.attrs)) {
          offenders.push(`${relative(FRONTEND_APP, file)} -> id="${attr(f.attrs, 'id')}"`);
        }
      }
    }

    expect(
      offenders,
      'a show/hide toggle on an email field is wrong, and means the conversion ' +
        `hit the wrong element. Found: ${offenders.join('; ')}`
    ).toEqual([]);
  });

  it('THE SERIOUS HALF: no input lost its type and defaults to cleartext', () => {
    // An <input> with no `type` renders as type="text". If that happened to a
    // password field, the password is displayed in the clear.
    const offenders = [];
    for (const file of files) {
      for (const f of extractFields(readFileSync(file, 'utf8'))) {
        if (f.tag !== 'input') continue;
        if (attr(f.attrs, 'type')) continue;
        if (looksLikePassword(f.attrs)) {
          offenders.push(
            `${relative(FRONTEND_APP, file)} -> id="${attr(f.attrs, 'id')}" has NO type`
          );
        }
      }
    }

    expect(
      offenders,
      `an untyped input renders as text — a password field would be shown in cleartext. Found: ${offenders.join('; ')}`
    ).toEqual([]);
  });

  it('no tag match spans two elements', () => {
    // The precise failure mode of the original regex.
    const offenders = [];
    for (const file of files) {
      for (const f of extractFields(readFileSync(file, 'utf8'))) {
        if (f.spansMultiple) offenders.push(relative(FRONTEND_APP, file));
      }
    }
    expect(offenders, `a tag appears to contain another input: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every password field USES the shared component', () => {
    // The inverse direction: a raw type="password" means someone added a field
    // without the toggle, so the pages drift apart again.
    const offenders = [];
    for (const file of files) {
      if (/type="password"/.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative(FRONTEND_APP, file));
      }
    }
    expect(
      offenders,
      `use <PasswordInput>, not a raw type="password" input: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('SANITY: the scan actually finds the fields (or every assertion above is vacuous)', () => {
    let passwordInputs = 0;
    for (const file of files) {
      passwordInputs += extractFields(readFileSync(file, 'utf8')).filter(
        (f) => f.tag === 'PasswordInput'
      ).length;
    }
    // login 1, register 2, reset-password 2, profile 3, admin/login 1
    expect(passwordInputs, 'expected the nine converted password fields').toBe(9);
  });
});
