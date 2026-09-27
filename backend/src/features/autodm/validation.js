/**
 * Request validation for /api/autodm — the repo's own validate() + zod, with
 * .strict() so unknown keys are a 400 (no mass assignment).
 *
 * Limits (Meta's, or tighter):
 *   name ≤60 · keywords / exclude words ≤30 items, each ≤50 chars
 *   opener and follow prompt ≤640 chars (button-template text cap) and ≤1000 UTF-8 bytes
 *   main text ≤640 chars with a link button, else ≤900 chars; always ≤1000 UTF-8 bytes
 *   button labels ≤20 chars · public replies ≤3, each ≤300 chars
 *   link: https:// with a real domain name only (no http:, javascript:, data:,
 *         credentials, IP literals or localhost)
 */

const { z } = require('../../middleware/validate');
const { ID_RE, utf8Bytes } = require('./util');
const {
  DEFAULT_OPENER_BUTTON,
  DEFAULT_FALLBACK_KEYWORD,
} = require('./messages');

const MAX_TEXT_BYTES = 1000;
const TEMPLATE_TEXT_MAX = 640;
const PLAIN_TEXT_MAX = 900;

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}[a-z0-9]$/i;

function isSafeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  if (!HOSTNAME_RE.test(host)) return false; // rejects IP literals, localhost, bare names
  return true;
}

const withinBytes = (s) => utf8Bytes(s) <= MAX_TEXT_BYTES;

const message = (maxChars) =>
  z
    .string()
    .trim()
    .min(1, 'cannot be empty')
    .max(maxChars, `use at most ${maxChars} characters`)
    .refine(withinBytes, 'is too long for an Instagram message');

const label = z.string().trim().min(1, 'cannot be empty').max(20, 'use at most 20 characters');
const keyword = z.string().trim().min(1, 'cannot be empty').max(50, 'use at most 50 characters');
const mediaId = z.string().regex(ID_RE, 'is not a valid post id');
const uuid = z.string().uuid('must be a valid id');

const automationBody = z
  .object({
    instagramAccountId: uuid,
    name: z.string().trim().min(1, 'cannot be empty').max(60, 'use at most 60 characters'),
    status: z.enum(['active', 'paused']).default('active'),
    postScope: z.enum(['ANY', 'SPECIFIC']),
    mediaIds: z.array(mediaId).max(50, 'pick at most 50 posts').default([]),
    triggerType: z.enum(['ANY_COMMENT', 'KEYWORDS']),
    keywords: z.array(keyword).max(30, 'use at most 30 keywords').default([]),
    excludeKeywords: z.array(keyword).max(30, 'use at most 30 exclude words').default([]),
    publicReplyEnabled: z.boolean().default(false),
    publicReplies: z
      .array(z.string().trim().min(1, 'cannot be empty').max(300, 'use at most 300 characters'))
      .max(3, 'use at most 3 replies')
      .default([]),
    openerText: message(TEMPLATE_TEXT_MAX),
    openerButtonLabel: label.default(DEFAULT_OPENER_BUTTON),
    fallbackKeyword: z
      .string()
      .trim()
      .min(1, 'cannot be empty')
      .max(20, 'use at most 20 characters')
      .refine((v) => !/^autodm:/i.test(v), 'is reserved')
      .default(DEFAULT_FALLBACK_KEYWORD),
    mainText: message(PLAIN_TEXT_MAX),
    imageId: uuid.nullable().default(null),
    linkUrl: z
      .string()
      .trim()
      .refine(isSafeHttpsUrl, 'must be a full https:// link')
      .nullable()
      .default(null),
    linkLabel: label.nullable().default(null),
    followGateEnabled: z.boolean().default(false),
    followPromptText: message(TEMPLATE_TEXT_MAX).nullable().default(null),
    followButtonLabel: label.nullable().default(null),
    followFailText: message(PLAIN_TEXT_MAX).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path, msg) => ctx.addIssue({ code: 'custom', path: [path], message: msg });
    if (v.postScope === 'SPECIFIC' && v.mediaIds.length === 0) issue('mediaIds', 'pick at least one post');
    if (v.triggerType === 'KEYWORDS' && v.keywords.length === 0) issue('keywords', 'add at least one keyword');
    if (v.publicReplyEnabled && v.publicReplies.length === 0) issue('publicReplies', 'add at least one reply');
    if (v.linkUrl && !v.linkLabel) issue('linkLabel', 'add a button label for the link');
    if (!v.linkUrl && v.linkLabel) issue('linkUrl', 'add the link for this button');
    if (v.linkUrl && v.mainText.length > TEMPLATE_TEXT_MAX) {
      issue('mainText', `use at most ${TEMPLATE_TEXT_MAX} characters when the message has a link button`);
    }
  });

const idParams = z.object({ id: uuid }).strict();
const accountParams = z.object({ accountId: uuid }).strict();
const listQuery = z.object({ accountId: uuid.optional() }).strict();
const statusBody = z.object({ status: z.enum(['active', 'paused']) }).strict();

module.exports = {
  automationBody,
  idParams,
  accountParams,
  listQuery,
  statusBody,
  isSafeHttpsUrl,
  TEMPLATE_TEXT_MAX,
  MAX_TEXT_BYTES,
};
