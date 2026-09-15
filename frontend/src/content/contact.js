/**
 * The support address printed on the public legal pages.
 *
 * /privacy, /terms, and /data-deletion are URLs a Meta App Review reviewer
 * opens directly, and each one tells the reader to email us. When
 * NEXT_PUBLIC_SUPPORT_EMAIL was unset those pages rendered the literal string
 * "set NEXT_PUBLIC_SUPPORT_EMAIL" in place of an address — a developer note
 * published on a compliance page, and a failed review.
 *
 * So the missing value is now a build failure in production rather than a
 * silent one — `next build` throws and stops. In development, where that
 * throw does not apply, the fallback is the real public address
 * (support@siffty.com) rather than a placeholder string, so a dev machine
 * with no .env.local still renders a legitimate, reachable address instead
 * of publishing a developer note. HAS_SUPPORT_EMAIL still reports whether an
 * address was actually configured, for anything that needs to tell the two
 * apart.
 *
 * Set NEXT_PUBLIC_SUPPORT_EMAIL in frontend/.env.local and in the deployment
 * environment. It must be an address a real person reads — deletion requests
 * arrive here, and the pages promise a reply within 30 days.
 */

const configured = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();

if (!configured && process.env.NODE_ENV === 'production') {
  throw new Error(
    'NEXT_PUBLIC_SUPPORT_EMAIL is not set. The privacy, terms, and data deletion ' +
    'pages print this address and are required to be reachable for Meta App Review. ' +
    'Set it in the deployment environment and rebuild.'
  );
}

export const SUPPORT_EMAIL = configured || 'support@siffty.com';

/** True only when a real address is configured. */
export const HAS_SUPPORT_EMAIL = Boolean(configured);

/**
 * The business as registered, for /contact.
 *
 * The operator name matches /terms and /privacy. The CITY is not recorded
 * anywhere in this repository, so it comes from the owner through
 * NEXT_PUBLIC_BUSINESS_CITY and is never guessed: unset, the page states the
 * country alone rather than publishing an address that might be wrong.
 */
export const BUSINESS_NAME = 'Siffty (proprietor: Mubassir Shah)';
export const BUSINESS_CITY = process.env.NEXT_PUBLIC_BUSINESS_CITY?.trim() || null;
export const BUSINESS_COUNTRY = 'India';
