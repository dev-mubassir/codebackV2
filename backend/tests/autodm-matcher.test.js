/**
 * Adapted from OpenReply (MIT) — __tests__/keyword-matcher.test.ts and
 * __tests__/keyword-matcher-arabic-script.test.ts.
 * Copyright (c) 2026 Anish Raj, Copyright (c) 2026 Diwen Huang.
 * See THIRD_PARTY_NOTICES.md.
 *
 * Plus Siffty's own cases: Devanagari, Hinglish, emoji keywords, and the
 * automation-selection rules (SPECIFIC beats ANY, newest wins, exclude words).
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  matchKeywords,
  stripSpecialCharacters,
  foldDiacritics,
  normalizeArabicScript,
  selectAutomation,
} = require('../src/features/autodm/matcher.js');

const m = (text, kw) => matchKeywords(text, [kw]).matched;

describe('stripSpecialCharacters (ported)', () => {
  it('removes emoji and punctuation, keeps letters/numbers of any script', () => {
    expect(stripSpecialCharacters('Hello 🔥 World 💪')).toBe('Hello World');
    expect(stripSpecialCharacters('price!!??')).toBe('price');
    expect(stripSpecialCharacters('hello   world')).toBe('hello world');
    expect(stripSpecialCharacters('')).toBe('');
    expect(stripSpecialCharacters('🔥💪😊')).toBe('');
    expect(stripSpecialCharacters('price123')).toBe('price123');
    expect(stripSpecialCharacters('Клод!!')).toBe('Клод');
    expect(stripSpecialCharacters('链接')).toBe('链接');
  });
});

describe('matchKeywords — whole word (ported)', () => {
  it('is case-insensitive', () => {
    expect(m('give me the Link please', 'LINK')).toBe(true);
    expect(m('LINK', 'link')).toBe(true);
    expect(m('liNk', 'LINK')).toBe(true);
  });

  it('does not match inside another word', () => {
    expect(m('linking', 'link')).toBe(false);
    expect(m('pricey', 'price')).toBe(false);
  });

  it('matches at the start and at the end', () => {
    expect(m('link please', 'link')).toBe(true);
    expect(m('please send the link', 'link')).toBe(true);
  });

  it('returns the first matching keyword (OR logic)', () => {
    const r = matchKeywords('what is the price', ['info', 'price', 'link']);
    expect(r).toEqual({ matched: true, matchedKeyword: 'price' });
  });

  it('no match returns null', () => {
    expect(matchKeywords('hello there', ['price', 'link'])).toEqual({ matched: false, matchedKeyword: null });
  });

  it('Cyrillic and CJK', () => {
    expect(m('хочу Клод плиз', 'Клод')).toBe(true);
    expect(m('🔥 Клод! 🔥', 'Клод')).toBe(true);
    expect(m('клод', 'КЛОД')).toBe(true);
    expect(m('Клодом', 'Клод')).toBe(false);
  });

  it('numeric keywords also match the letter-O typo, still whole-word', () => {
    expect(m('O8', '08')).toBe(true);
    expect(m('o8', '08')).toBe(true);
    expect(m('comentei O8 aqui', '08')).toBe(true);
    expect(matchKeywords('O8', ['08']).matchedKeyword).toBe('08');
    expect(m('eu gordo', 'adoro')).toBe(false);
    expect(m('108', '08')).toBe(false);
  });

  it('edge cases', () => {
    expect(m('', 'link')).toBe(false);
    expect(matchKeywords('give me the link', []).matched).toBe(false);
    expect(m('🔥🔥🔥', 'link')).toBe(false);
    expect(m('🔥 LINK 🔥', 'link')).toBe(true);
    expect(m('send info', 'info!')).toBe(true);
    expect(m('I want more info please', 'more info')).toBe(true);
  });
});

describe('diacritics (ported)', () => {
  it('folds Latin accents only', () => {
    expect(foldDiacritics('preço')).toBe('preco');
    expect(foldDiacritics('café crème')).toBe('cafe creme');
    expect(foldDiacritics('é')).toBe('e');
    expect(foldDiacritics('é')).toBe('e');
    expect(foldDiacritics('йод Клод Україна')).toBe('йод Клод Україна');
    expect(foldDiacritics('किताब')).toBe('किताब');
    expect(foldDiacritics('ガード')).toBe('ガード');
    expect(foldDiacritics('Fußball')).toBe('Fußball');
  });

  it('matches in both directions and keeps word boundaries', () => {
    expect(m('PREÇO?', 'preco')).toBe(true);
    expect(m('preco por favor', 'preço')).toBe(true);
    expect(m('cual es el precio', 'cuál')).toBe(true);
    expect(m('apreço isso', 'preco')).toBe(false);
    expect(m('иод', 'йод')).toBe(false);
  });
});

describe('Arabic script (ported)', () => {
  it('normalises keyboard variants, harakat, tatweel, ZWNJ and digits', () => {
    expect(normalizeArabicScript('لينك')).toBe('لینک');
    expect(normalizeArabicScript('هدية')).toBe('هدیه');
    expect(normalizeArabicScript('لیــنک')).toBe('لینک');
    expect(normalizeArabicScript('قیمت‌ها')).toBe('قیمتها');
    expect(normalizeArabicScript('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('matches across those variants, still whole-word', () => {
    expect(m('لينك بده لطفا', 'لینک')).toBe(true);
    expect(m('لینک بده لطفا', 'لينك')).toBe(true);
    expect(m('کد۵ رو میخوام', 'کد5')).toBe(true);
    expect(m('لینکدونی', 'لینک')).toBe(false);
  });
});

describe('Devanagari (Siffty)', () => {
  it('matches whole Hindi words and phrases', () => {
    expect(m('कीमत क्या है', 'कीमत')).toBe(true);
    expect(m('लिंक भेजो', 'लिंक')).toBe(true);
    expect(m('मुझे   लिंक   भेजो!', 'लिंक भेजो')).toBe(true);
    expect(m('भाई लिंक?', 'लिंक')).toBe(true);
  });

  it('a vowel sign after the keyword makes it a different word (marks are part of the word)', () => {
    expect(m('कीमतें बताओ', 'कीमत')).toBe(false);
    expect(m('लिंकडइन', 'लिंक')).toBe(false);
  });

  it('precomposed and decomposed nukta compare equal', () => {
    expect(m('ज़रूर भेजो', 'ज़रूर')).toBe(true);
  });

  it('Devanagari digits are not folded to ASCII (only Arabic-script digits are)', () => {
    expect(m('कोड ५', 'कोड ५')).toBe(true);
  });
});

describe('Hinglish (Siffty)', () => {
  it('matches Latin-script Hindi, case-insensitively', () => {
    expect(m('link bhejo pls', 'link')).toBe(true);
    expect(m('LINK chahiye bhai', 'link')).toBe(true);
    expect(m('bhai kitne   ka hai?', 'kitne ka hai')).toBe(true);
    expect(m('Price kya hai??', 'price kya')).toBe(true);
    expect(m('guide dedo', 'guide')).toBe(true);
  });

  it('does not match inside longer words', () => {
    expect(m('linkedin pe hai', 'link')).toBe(false);
    expect(m('guidelines bhejo', 'guide')).toBe(false);
  });

  it('mixed Hinglish and Devanagari in one comment', () => {
    expect(m('bhai लिंक bhejo', 'लिंक')).toBe(true);
    expect(m('bhai लिंक bhejo', 'bhejo')).toBe(true);
  });
});

describe('emoji keywords and full-width text (Siffty)', () => {
  it('an emoji-only keyword matches wherever the emoji appears', () => {
    expect(m('love it 🔥🔥', '🔥')).toBe(true);
    expect(m('love it', '🔥')).toBe(false);
  });

  it('full-width letters fold (NFKC)', () => {
    expect(m('Ｌｉｎｋ please', 'link')).toBe(true);
  });
});

describe('selectAutomation', () => {
  const base = { status: 'active', postScope: 'ANY', mediaIds: [], triggerType: 'KEYWORDS', keywords: ['guide'], excludeKeywords: [] };
  const at = (iso) => new Date(iso);

  it('SPECIFIC beats ANY, then the newest wins', () => {
    const any = { ...base, id: 'any', createdAt: at('2026-09-20') };
    const newerAny = { ...base, id: 'newer-any', createdAt: at('2026-09-25') };
    const specific = { ...base, id: 'specific', postScope: 'SPECIFIC', mediaIds: ['m1'], createdAt: at('2026-09-01') };
    expect(selectAutomation([any, newerAny, specific], { text: 'guide please', mediaId: 'm1' }).id).toBe('specific');
    expect(selectAutomation([any, newerAny, specific], { text: 'guide please', mediaId: 'm2' }).id).toBe('newer-any');
  });

  it('a boosted-post comment matches through original_media_id', () => {
    const specific = { ...base, id: 's', postScope: 'SPECIFIC', mediaIds: ['post-1'], createdAt: at('2026-09-01') };
    expect(selectAutomation([specific], { text: 'guide', mediaId: 'ad-9', originalMediaId: 'post-1' }).id).toBe('s');
  });

  it('exclude words veto; paused automations never match; ANY_COMMENT matches anything', () => {
    const excl = { ...base, id: 'x', excludeKeywords: ['spam'], createdAt: at('2026-09-01') };
    expect(selectAutomation([excl], { text: 'guide spam', mediaId: null })).toBeNull();
    expect(selectAutomation([{ ...base, id: 'p', status: 'paused', createdAt: at('2026-09-01') }], { text: 'guide', mediaId: null })).toBeNull();
    const anyComment = { ...base, id: 'all', triggerType: 'ANY_COMMENT', keywords: [], createdAt: at('2026-09-01') };
    expect(selectAutomation([anyComment], { text: '😍', mediaId: null }).id).toBe('all');
  });
});
