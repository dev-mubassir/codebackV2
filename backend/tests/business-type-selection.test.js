/**
 * Business-type selection never puts a type on a profile that the user did
 * not pick.
 *
 * The bug this pins: the onboarding wizard started on "Video editor" — in
 * its initial state, for a profile with no saved types, and with no profile at
 * all — and loaded that type's starter prices and services, while the backend
 * default was "Something else". A user who picked nothing got a business type
 * they never chose, quoted back to real customers.
 *
 * The frontend has no test runner, so this imports the one pure rule both
 * pages use (content/templates.js toggleBusinessType), and scans the wizard's
 * source for a hard-coded real-type default.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  DEFAULT_BUSINESS_TYPE,
  toggleBusinessType,
  parseBusinessTypes,
  BUSINESS_CATEGORIES,
} from '../../frontend/src/content/templates.js';

const require = createRequire(import.meta.url);
const { DEFAULT_PROFILE } = (() => {
  // DEFAULT_PROFILE is module-private; read its businessTypes the same way the
  // service writes it, from a fresh require of the source text.
  const src = fs.readFileSync(require.resolve('../src/services/businessProfileService.js'), 'utf8');
  const types = src.match(/businessTypes:\s*JSON\.stringify\((\[[^\]]*\])\)/)[1];
  const primary = src.match(/primaryCategory:\s*'([^']+)'/)[1];
  return { DEFAULT_PROFILE: { businessTypes: JSON.parse(types.replace(/'/g, '"')), primaryCategory: primary } };
})();

describe('the default business type', () => {
  it('is "Something else", and matches the backend default profile', () => {
    expect(DEFAULT_BUSINESS_TYPE).toBe('other');
    expect(BUSINESS_CATEGORIES.find((c) => c.id === DEFAULT_BUSINESS_TYPE)?.label).toBe('Something else');
    expect(DEFAULT_PROFILE.businessTypes).toEqual([DEFAULT_BUSINESS_TYPE]);
    expect(DEFAULT_PROFILE.primaryCategory).toBe(DEFAULT_BUSINESS_TYPE);
  });

  it('an empty or missing saved selection reads as "Something else"', () => {
    expect(parseBusinessTypes(null, undefined)).toEqual([DEFAULT_BUSINESS_TYPE]);
    expect(parseBusinessTypes('', undefined)).toEqual([DEFAULT_BUSINESS_TYPE]);
    expect(parseBusinessTypes('[]', undefined)).toEqual([DEFAULT_BUSINESS_TYPE]);
  });

  it('the onboarding wizard has no hard-coded real-type default', () => {
    const src = fs.readFileSync(new URL('../../frontend/src/app/onboarding/page.js', import.meta.url), 'utf8');
    for (const cat of BUSINESS_CATEGORIES.filter((c) => c.id !== DEFAULT_BUSINESS_TYPE)) {
      expect(src, `onboarding must not default to '${cat.id}'`).not.toContain(`'${cat.id}'`);
    }
  });
});

describe('onboarding starts with NOTHING selected', () => {
  const src = () => fs.readFileSync(new URL('../../frontend/src/app/onboarding/page.js', import.meta.url), 'utf8');

  /**
   * These read the wizard's SOURCE, because the frontend has no component test
   * runner. That makes them sensitive to renames, which is a real cost: the
   * 2026-09 rebuild renamed `selectedCategories` to `selected` and moved the
   * toggle out of a setState updater, and all three failed while the behaviour
   * they pin was intact.
   *
   * So the patterns below match on the SHAPE of the rule rather than on one
   * spelling of the variable: "the selection state initialises to []", "the
   * Next button is disabled on an empty selection", "the toggle runs in
   * allowEmpty mode". A rename keeps passing; deleting the rule does not.
   */
  const SELECTION_STATE = /const \[(\w+), set\w+\] = useState\(\[\]\);/;

  it('the wizard selection starts empty — no real type, no "Something else", no saved placeholder', () => {
    const text = src();
    const match = text.match(SELECTION_STATE);
    expect(match, 'the selection state must initialise to an empty array').toBeTruthy();

    const stateName = match[1];
    // The saved businessTypes must never be pushed into the selection: a fresh
    // profile holds the "Something else" placeholder, which is nobody's answer.
    expect(text, 'saved types must not be loaded into the selection').not.toMatch(
      new RegExp(`set${stateName[0].toUpperCase()}${stateName.slice(1)}\\((?:initialCats|bp\\.|data\\.)`, 'i'),
    );
    expect(text).not.toContain('DEFAULT_BUSINESS_TYPE');
  });

  it('step 2 cannot continue until at least one type is picked', () => {
    const stateName = src().match(SELECTION_STATE)[1];
    expect(src()).toMatch(new RegExp(`disabled=\\{${stateName}\\.length === 0\\}`));
  });

  it('onboarding toggles in allowEmpty mode', () => {
    expect(src()).toMatch(/toggleBusinessType\(\s*\w+,\s*\w+,\s*\{ allowEmpty: true \}\s*\)/);
  });
});

describe('toggleBusinessType in onboarding mode (allowEmpty)', () => {
  const tap = (current, id) => toggleBusinessType(current, id, { allowEmpty: true });

  it('the first pick is exactly that type', () => {
    expect(tap([], 'real_estate')).toEqual(['real_estate']);
    expect(tap([], 'other')).toEqual(['other']);
  });

  it('"Something else" is an ordinary choice — picking another type does NOT replace it', () => {
    expect(tap(['other'], 'real_estate')).toEqual(['other', 'real_estate']);
  });

  it('turning off the last type leaves nothing selected — no fallback is chosen for the user', () => {
    expect(tap(['real_estate'], 'real_estate')).toEqual([]);
    expect(tap(['other'], 'other')).toEqual([]);
  });
});

describe('toggleBusinessType in Settings mode (a saved profile always holds at least the placeholder)', () => {
  it('picking a type while only the placeholder is on REPLACES the placeholder', () => {
    expect(toggleBusinessType(['other'], 'real_estate')).toEqual(['real_estate']);
    expect(toggleBusinessType([], 'video_editor')).toEqual(['video_editor']);
  });

  it('picking more types adds them', () => {
    expect(toggleBusinessType(['real_estate'], 'photographer')).toEqual(['real_estate', 'photographer']);
  });

  it('"Something else" can be added alongside real types', () => {
    expect(toggleBusinessType(['freelancer'], 'other')).toEqual(['freelancer', 'other']);
  });

  it('turning a type off removes it', () => {
    expect(toggleBusinessType(['real_estate', 'photographer'], 'real_estate')).toEqual(['photographer']);
  });

  it('turning off the LAST type falls back to "Something else" — never an empty profile, never a refused tap', () => {
    expect(toggleBusinessType(['real_estate'], 'real_estate')).toEqual(['other']);
  });

  it('tapping the placeholder when it is the only selection keeps it', () => {
    expect(toggleBusinessType(['other'], 'other')).toEqual(['other']);
  });

  it('never returns a type that was not already selected or just tapped', () => {
    const ids = BUSINESS_CATEGORIES.map((c) => c.id);
    for (const start of [[], ['other'], ['video_editor'], ['real_estate', 'agency']]) {
      for (const tapped of ids) {
        const next = toggleBusinessType(start, tapped);
        for (const id of next) {
          expect([...start, tapped, DEFAULT_BUSINESS_TYPE], `${JSON.stringify(start)} + ${tapped}`).toContain(id);
        }
        expect(next.length, 'never empty').toBeGreaterThan(0);
      }
    }
  });
});
