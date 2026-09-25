/**
 * THE classification output schema (Gate 4) — one contract for every
 * provider. The prompt in services/aiService.js asks for exactly this shape.
 *
 * validateClassification(raw) -> { valid, errors }
 *
 * Used in two places:
 *   - production: an answer that fails is treated as a FAILED call
 *     (logged SCHEMA_INVALID), never half-trusted and patched up;
 *   - the admin model test: a candidate provider/model can be activated
 *     only if all ten synthetic samples come back schema-valid.
 *
 * Deliberately a hand-written validator rather than a JSON-Schema library:
 * one flat object, and no new dependency.
 */

const { CATEGORIES, CUSTOMER_TYPES, LEGACY_CATEGORY_MAP } = require('../constants');

// Exactly what normalizeCategory() maps without falling back to 'other':
// a current category, or one of the legacy names it knows. Case matters,
// because normalizeCategory's own lookup is exact.
const knownCategory = (v) => typeof v === 'string' && (CATEGORIES.includes(v) || Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_MAP, v));
const RISK = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isStr = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function validateClassification(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { valid: false, errors: ['not an object'] };

  const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
  if (!knownCategory(raw.category)) errors.push('category');
  if (!isStr(raw.intent, 200)) errors.push('intent');
  if (!(typeof raw.customer_type === 'string' && CUSTOMER_TYPES.includes(lower(raw.customer_type)))) errors.push('customer_type');
  for (const k of ['purchase_intent', 'lead_quality', 'scam_probability']) if (!isNum(raw[k], 0, 100)) errors.push(k);
  for (const k of ['commercial_relevance', 'urgency']) if (raw[k] !== undefined && !isNum(raw[k], 0, 100)) errors.push(k);
  if (!(typeof raw.risk_level === 'string' && RISK.includes(raw.risk_level.trim().toUpperCase()))) errors.push('risk_level');
  if (!isNum(raw.confidence, 0, 1)) errors.push('confidence');
  if (typeof raw.should_auto_reply !== 'boolean') errors.push('should_auto_reply');
  if (typeof raw.requires_human_attention !== 'boolean') errors.push('requires_human_attention');
  if (!isStr(raw.summary, 600)) errors.push('summary');
  if (!isStr(raw.reasoning, 600)) errors.push('reasoning');
  if (!isStr(raw.recommended_action, 200)) errors.push('recommended_action');
  if (raw.sentiment !== undefined && typeof raw.sentiment !== 'string') errors.push('sentiment');
  if (raw.brand_deal !== undefined && raw.brand_deal !== null && (typeof raw.brand_deal !== 'object' || Array.isArray(raw.brand_deal))) {
    errors.push('brand_deal');
  }

  return { valid: errors.length === 0, errors };
}

/** Summaries: { summary: string, stage?: string }. */
function validateSummary(raw) {
  const ok = raw && typeof raw === 'object' && isStr(raw.summary, 1000) && (raw.stage === undefined || raw.stage === null || typeof raw.stage === 'string');
  return { valid: Boolean(ok), errors: ok ? [] : ['summary'] };
}

module.exports = { validateClassification, validateSummary };
