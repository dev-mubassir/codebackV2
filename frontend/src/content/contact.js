/**
 * The support address printed on the public legal pages.
 *
 * /privacy, /terms, and /data-deletion are URLs a Meta App Review reviewer
 * opens directly, and each one tells the reader to email us. When
 * NEXT_PUBLIC_SUPPORT_EMAIL was unset those pages rendered the literal string
 * "set NEXT_PUBLIC_SUPPORT_EMAIL" in place of an address — a developer note
 * published on a compliance page, and a failed review.
 *
 * So the missing value is now a build failure rather than a silent one:
 *
 *   - production build: throws, and `next build` stops
 *   - development:      renders a loud placeholder so it is obvious on screen
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

export const SUPPORT_EMAIL = configured || 'NOT CONFIGURED — set NEXT_PUBLIC_SUPPORT_EMAIL';

/** True only when a real address is configured. */
export const HAS_SUPPORT_EMAIL = Boolean(configured);
