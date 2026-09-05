import Image from 'next/image';

/**
 * The Codeback logo, for the auth pages.
 *
 * Replaces the generic lucide "zap" glyph that stood in for a brand mark on
 * login, register and forgot-password. Shared so those three stay identical —
 * three separate copies would drift the moment one is restyled.
 *
 * Uses the real asset at public/logo.png. `priority` because it sits above the
 * fold on the first screen an unauthenticated visitor sees, and lazy-loading
 * it produces a visible pop-in on the page most likely to be someone's first
 * impression.
 *
 * The alt text is deliberately empty: this is decorative here — the page's own
 * <h1> already names the product, so announcing "Codeback logo" immediately
 * before "Log in to Codeback" is duplication for a screen reader user.
 */
export default function BrandLogo({ size = 40, className, style }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      priority
      className={className}
      style={{ objectFit: 'contain', borderRadius: 8, ...style }}
    />
  );
}
