import Image from 'next/image';

/**
 * Official Siffty 3D Brand Logo
 * Unified across auth, dashboard, and public views
 */
export default function BrandLogo({ size = 40, className, style }) {
  return (
    <Image
      src="/assets/siffty-logo.webp"
      alt="Siffty Logo"
      width={size}
      height={size}
      priority
      className={className}
      style={{ objectFit: 'contain', ...style }}
    />
  );
}
