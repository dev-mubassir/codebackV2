/**
 * Adapted from OpenReply (MIT) — lib/utils/keyword-matcher.ts.
 * Copyright (c) 2026 Anish Raj, Copyright (c) 2026 Diwen Huang.
 * See THIRD_PARTY_NOTICES.md.
 *
 * Which automation (if any) a comment triggers. Pure functions, no I/O.
 *
 * The comparison pipeline, applied to BOTH the comment and the keyword:
 *   1. Arabic-script folding (keyboard letter variants, harakat, tatweel,
 *      ZWNJ, Persian/Arabic-Indic digits) — OpenReply.
 *   2. Strip emoji and punctuation to spaces, keeping letters, numbers and
 *      combining marks of every script; collapse whitespace — OpenReply.
 *   3. Fold diacritics on LATIN letters only ("preço" = "preco"), leaving
 *      Devanagari, Cyrillic, Thai, Japanese etc. byte-identical — OpenReply.
 *   4. Lower-case.
 *   5. Numeric-like keywords ("08") also match the letter-O typo ("O8") —
 *      OpenReply.
 *
 * Whole word / whole phrase: the keyword must not touch another letter,
 * number OR combining mark. Siffty change: OpenReply's boundary is letters and
 * numbers only, which lets "कीमत" match inside "कीमतें" (the vowel sign after
 * it is a mark). Treating marks as part of the word keeps Devanagari and
 * other abugidas strictly whole-word.
 *
 * Siffty change: a keyword made only of emoji/symbols (e.g. "🔥") would be
 * stripped to nothing by step 2, so it is matched on the NFKC text instead —
 * emoji keywords work.
 *
 * Precedence when several automations match: SPECIFIC post scope beats ANY,
 * then the newest automation wins. One run per comment.
 */

// ---------------------------------------------------------------------------
// Normalisation (ported)
// ---------------------------------------------------------------------------

// Read this table by codepoint, not by eye: several sources render identically
// to their targets (U+064A vs U+06CC, U+0643 vs U+06A9).
const ARABIC_SCRIPT_FOLDING = [
  [/[يىے]/gu, 'ی'], // Arabic yeh, alef maksura, barree ye -> Persian yeh
  [/ك/gu, 'ک'], // Arabic kaf -> keheh
  [/ة/gu, 'ه'], // teh marbuta -> heh
  [/[آأإٱ]/gu, 'ا'], // alef with madda/hamza/wasla -> alef
  [/[ً-ْٰ]/gu, ''], // harakat, sukun, superscript alef
  [/ـ/gu, ''], // tatweel
  [/[‌‎‏]/gu, ''], // ZWNJ and bidi marks
];

const EASTERN_DIGITS = /[۰-۹٠-٩]/gu;

function normalizeArabicScript(text) {
  let out = text;
  for (const [pattern, replacement] of ARABIC_SCRIPT_FOLDING) out = out.replace(pattern, replacement);
  return out.replace(EASTERN_DIGITS, (digit) => {
    const code = digit.codePointAt(0);
    const zero = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - zero);
  });
}

function stripSpecialCharacters(text) {
  return text
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function foldDiacritics(text) {
  let out = '';
  let baseIsLatin = false;
  for (const char of text.normalize('NFD')) {
    if (/\p{M}/u.test(char)) {
      if (!baseIsLatin) out += char; // a mark inherits its base character's script
      continue;
    }
    baseIsLatin = /\p{Script=Latin}/u.test(char);
    out += char;
  }
  return out.normalize('NFC');
}

function clean(text) {
  return foldDiacritics(stripSpecialCharacters(normalizeArabicScript(String(text || '').normalize('NFKC')))).toLowerCase();
}

const isNumericLike = (k) => /^[0-9o]+$/i.test(k);
const foldNumericHomoglyphs = (v) => v.replace(/o/gi, '0');

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const BOUNDARY = '[\\p{L}\\p{N}\\p{M}]';
const regexCache = new Map();

function wholeWordRegex(keyword) {
  let re = regexCache.get(keyword);
  if (!re) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(?<!${BOUNDARY})${escaped}(?!${BOUNDARY})`, 'u');
    if (regexCache.size > 5000) regexCache.clear();
    regexCache.set(keyword, re);
  }
  return re;
}

function symbolForm(text) {
  return String(text || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/**
 * The first keyword that `text` contains as a whole word or phrase.
 * @returns {{ matched: boolean, matchedKeyword: string|null }}
 */
function matchKeywords(text, keywords) {
  const none = { matched: false, matchedKeyword: null };
  if (!text || !Array.isArray(keywords) || keywords.length === 0) return none;

  const cleanedText = clean(text);

  for (const keyword of keywords) {
    const cleanedKeyword = clean(keyword);

    if (!cleanedKeyword) {
      // Emoji / symbol-only keyword: plain containment on the NFKC text.
      const sym = symbolForm(keyword);
      if (sym && symbolForm(text).includes(sym)) return { matched: true, matchedKeyword: keyword };
      continue;
    }
    if (!cleanedText) continue;

    const numeric = isNumericLike(cleanedKeyword);
    const haystack = numeric ? foldNumericHomoglyphs(cleanedText) : cleanedText;
    const needle = numeric ? foldNumericHomoglyphs(cleanedKeyword) : cleanedKeyword;
    if (wholeWordRegex(needle).test(haystack)) return { matched: true, matchedKeyword: keyword };
  }
  return none;
}

const containsKeyword = (text, keyword) => matchKeywords(text, [keyword]).matched;
const containsAny = (text, keywords) => matchKeywords(text, keywords).matched;

// ---------------------------------------------------------------------------
// Automation selection
// ---------------------------------------------------------------------------

/**
 * A comment on a boosted post arrives with the AD's media id and the post's id
 * in original_media_id (OpenReply); a SPECIFIC automation matches either.
 */
function postScopeMatches(automation, comment) {
  if (automation.postScope !== 'SPECIFIC') return true;
  const ids = Array.isArray(automation.mediaIds) ? automation.mediaIds : [];
  return [comment.mediaId, comment.originalMediaId].some((id) => id && ids.includes(String(id)));
}

/**
 * Exclude words veto a match under either trigger type (fewer DMs is the safe
 * direction). ANY_COMMENT matches any comment, including an emoji-only one.
 */
function triggerMatches(automation, text) {
  if (containsAny(text, automation.excludeKeywords)) return false;
  if (automation.triggerType === 'KEYWORDS') return containsAny(text, automation.keywords);
  return true;
}

/**
 * The winning automation for a comment, or null.
 * @param {Array} automations  the account's automations (only `active` count)
 * @param {{ text: string, mediaId: string|null, originalMediaId?: string|null }} comment
 */
function selectAutomation(automations, comment) {
  const matches = (automations || []).filter(
    (a) => a.status === 'active' && postScopeMatches(a, comment) && triggerMatches(a, comment.text)
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const scope = (b.postScope === 'SPECIFIC') - (a.postScope === 'SPECIFIC');
    if (scope !== 0) return scope;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return matches[0];
}

module.exports = {
  matchKeywords,
  containsKeyword,
  containsAny,
  normalizeArabicScript,
  stripSpecialCharacters,
  foldDiacritics,
  postScopeMatches,
  triggerMatches,
  selectAutomation,
};
