/**
 * One validation middleware, one place.
 *
 * Every schema is .strict(), so UNKNOWN KEYS ARE REJECTED rather than ignored.
 * That is the part that matters: silently dropping unexpected fields is how a
 * mass-assignment bug hides. A request carrying `role: "ADMIN"` should be a
 * 400, not a quietly-discarded key that someone later spreads into a Prisma
 * update.
 *
 * Validated output REPLACES req.body / req.query / req.params, so handlers
 * read parsed, typed, whitelisted values rather than raw input. A handler
 * cannot accidentally reach past validation for a field the schema stripped.
 */

const { z } = require('zod');

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 */
function validate(schemas = {}) {
  return function validateRequest(req, res, next) {
    for (const source of ['params', 'query', 'body']) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (!result.success) {
        const issue = result.error.issues[0];
        const path = issue.path.join('.');
        // One message, naming the offending field. Enumerating every issue
        // gives a probing client a free map of the schema.
        return res.status(400).json({
          error: path ? `${path}: ${issue.message}` : issue.message,
          field: path || undefined,
        });
      }

      // req.query is a getter in Express 5; assigning to it throws. Mutating
      // in place keeps both Express 4 and 5 working.
      if (source === 'query') {
        for (const key of Object.keys(req.query)) delete req.query[key];
        Object.assign(req.query, result.data);
      } else {
        req[source] = result.data;
      }
    }
    return next();
  };
}

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const uuid = z.string().uuid('must be a valid id');

// Deliberately permissive on shape, strict on size. An over-clever email regex
// rejects valid addresses; the address is proven by sending mail to it, not by
// pattern matching.
const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'enter a valid email address')
  .max(254, 'that email address is too long')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'enter a valid email address');

// Minimum 6 to match the existing product rule. The MAXIMUM is the security
// relevant half: Argon2id hashes whatever it is given, so an unbounded password
// is an unbounded amount of hashing work per request.
const passwordField = z
  .string()
  .min(6, 'use at least 6 characters')
  .max(200, 'that password is too long');

const token = z.string().min(1, 'that link is not valid').max(500);

module.exports = {
  validate,
  z,
  fields: { uuid, email, password: passwordField, token },
};
