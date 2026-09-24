import Link from 'next/link';
import styles from './public.module.css';

export default function PublicHero({
  eyebrow = 'RESOURCES',
  title,
  subtitle,
  badgeText,
  breadcrumbCategory = 'Resources',
  breadcrumbCurrent,
  children,
}) {
  return (
    <section className={styles.heroSection}>
      <div className={styles.container}>
        {/* Breadcrumbs */}
        <div className={styles.breadcrumbs} aria-label="Breadcrumb">
          <Link href="/" className={styles.breadcrumbLink}>
            Home
          </Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span className={styles.breadcrumbLink}>{breadcrumbCategory}</span>
          <span className={styles.breadcrumbSep}>/</span>
          <span className={styles.breadcrumbCurrent}>{breadcrumbCurrent || title}</span>
        </div>

        {/* Eyebrow badge */}
        <div>
          <span className={styles.eyebrow}>
            <span className={styles.eyebrowDot} />
            <span>{eyebrow}</span>
          </span>
        </div>

        {/* Hero Title */}
        <h1 className={styles.heroTitle}>{title}</h1>

        {/* Hero Subtitle */}
        {subtitle && <p className={styles.heroSubtitle}>{subtitle}</p>}

        {/* Metadata badges or actions */}
        {badgeText && (
          <div className={styles.heroMeta}>
            <span className={styles.metaBadge}>
              <span className={styles.metaBadgeDot} />
              <span>{badgeText}</span>
            </span>
          </div>
        )}

        {children}
      </div>
    </section>
  );
}
