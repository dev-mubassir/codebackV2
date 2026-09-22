'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './public.module.css';

export default function PublicNavbar({ isFounderPage = false }) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const isFounder = isFounderPage || pathname === '/founder-developer';

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header className={`${styles.navbarWrapper} ${isScrolled ? styles.scrolled : ''}`} id="public-navbar">
      <nav className={styles.navbarContainer} aria-label="Main Navigation">
        <div className={styles.navbarLeft}>
          <Link href="/" className={styles.brandLogo} id="public-brand-logo" aria-label="Siffty Home">
            <img
              src="/assets/siffty-logo-tight.png"
              alt="Siffty Logo"
              className={styles.brandLogoImg}
              width="44"
              height="44"
            />
          </Link>

          <ul className={styles.navLinks}>
            <li>
              <Link href="/#features" className={styles.navLink}>
                Features
              </Link>
            </li>
            <li>
              <Link href="/#how-it-works" className={styles.navLink}>
                How it works
              </Link>
            </li>
            <li>
              <Link
                href="/how-to-use"
                className={`${styles.navLink} ${pathname === '/how-to-use' ? styles.navLinkActive : ''}`}
              >
                How to use
              </Link>
            </li>
            <li>
              <Link href="/#pricing" className={styles.navLink}>
                Pricing
              </Link>
            </li>
          </ul>
        </div>

        <div className={styles.navbarRight}>
          <Link href="/login" className={styles.btnText}>
            Sign in
          </Link>
          <Link
            href="/register"
            className={`${styles.btnPillDark} ${isFounder ? styles.btnPillDarkAlways : ''}`}
          >
            <span className="btn-text-roll">
              <span className="btn-text-track">
                <span className="btn-text-line">Get started</span>
                <span className="btn-text-line" aria-hidden="true">Get started</span>
              </span>
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
          {!isFounder && (
            <button
              className={`${styles.mobileToggleBtn} ${mobileOpen ? styles.mobileToggleActive : ''}`}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((prev) => !prev)}
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
      </nav>

      {/* Mobile Drawer */}
      {!isFounder && (
        <div className={`${styles.mobileDrawer} ${mobileOpen ? styles.mobileDrawerOpen : ''}`}>
          <div className={styles.mobileLinks}>
            <Link href="/#features" className={styles.mobileNavLink} onClick={() => setMobileOpen(false)}>
              Features
            </Link>
            <Link href="/#how-it-works" className={styles.mobileNavLink} onClick={() => setMobileOpen(false)}>
              How it works
            </Link>
            <Link href="/how-to-use" className={styles.mobileNavLink} onClick={() => setMobileOpen(false)}>
              How to use
            </Link>
            <Link href="/founder-developer" className={styles.mobileNavLink} onClick={() => setMobileOpen(false)}>
              Founder &amp; Developer
            </Link>
            <Link href="/#pricing" className={styles.mobileNavLink} onClick={() => setMobileOpen(false)}>
              Pricing
            </Link>
            <Link href="/support" className={styles.mobileNavLink} onClick={() => setMobileOpen(false)}>
              Support
            </Link>
            <Link href="/contact" className={styles.mobileNavLink} onClick={() => setMobileOpen(false)}>
              Contact
            </Link>
            <div className={styles.mobileActions}>
              <Link href="/login" className={styles.btnPillSecondary} onClick={() => setMobileOpen(false)}>
                Sign in
              </Link>
              <Link href="/register" className={styles.btnPillDark} onClick={() => setMobileOpen(false)}>
                <span className="btn-text-roll">
                  <span className="btn-text-track">
                    <span className="btn-text-line">Get started</span>
                    <span className="btn-text-line" aria-hidden="true">Get started</span>
                  </span>
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
