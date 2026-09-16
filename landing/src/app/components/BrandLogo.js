/**
 * The Siffty logo.
 *
 * Follows frontend/src/app/components/BrandLogo.js: one shared component so
 * every placement stays identical, and `alt=""` because the mark is
 * decorative here — the wordmark beside it already says "Siffty", and the
 * page's own <h1> names the product. Announcing "Siffty logo" immediately
 * before the word "Siffty" is duplication for a screen reader user.
 *
 * TWO DELIBERATE DIFFERENCES from the app's version:
 *
 * 1. <picture>, not next/image. The app ships one 512x512 PNG and lets the
 *    Next image optimizer resize it per request. Here the asset is already
 *    exactly the size it renders at (64px for a 32px slot), so the optimizer
 *    has nothing left to do and would only add a round trip to /_next/image
 *    in front of the first paint. <picture> also gives the PNG a real
 *    fallback rather than relying on the optimizer's format negotiation.
 *
 * 2. fetchPriority="high" in place of next/image's `priority`. Same intent:
 *    this sits above the fold on the first screen a visitor sees, and
 *    lazy-loading it produces a visible pop-in.
 *
 * Explicit width/height are load-bearing — without them the image has no
 * intrinsic size until it arrives and the brand row reflows (CLS).
 */
export default function BrandLogo({ size = 32, className }) {
  return (
    <picture>
      <source srcSet="/logo.webp" type="image/webp" />
      <img
        src="/logo.png"
        alt=""
        width={size}
        height={size}
        className={className}
        decoding="async"
        fetchPriority="high"
        style={{ objectFit: 'contain', borderRadius: 8 }}
      />
    </picture>
  );
}
