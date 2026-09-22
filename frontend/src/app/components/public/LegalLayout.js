'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import PublicNavbar from './PublicNavbar';
import PublicFooter from './PublicFooter';
import PublicHero from './PublicHero';
import { legal } from '@/content/copy';
import styles from './public.module.css';

export default function LegalLayout({
  eyebrow = 'LEGAL & COMPLIANCE',
  title,
  subtitle,
  badgeText,
  breadcrumbCategory = 'Legal',
  breadcrumbCurrent,
  tocItems = [],
  children,
}) {
  const [activeSection, setActiveSection] = useState(tocItems[0]?.id || '');

  useEffect(() => {
    if (!tocItems.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: 0.1,
      }
    );

    tocItems.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [tocItems]);

  return (
    <div className={styles.publicPage}>
      {/* Decorative Grid Overlay */}
      <div className={styles.bgGridOverlay} aria-hidden="true" />

      {/* Public Navbar */}
      <PublicNavbar />

      {/* Hero */}
      <PublicHero
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        badgeText={badgeText}
        breadcrumbCategory={breadcrumbCategory}
        breadcrumbCurrent={breadcrumbCurrent}
      />

      {/* 2-Column Document Layout */}
      <main className={styles.container}>
        <div className={styles.docLayout}>
          {/* Sidebar TOC */}
          {tocItems.length > 0 && (
            <aside className={styles.docSidebar} aria-label="Table of contents">
              <h2 className={styles.sidebarTitle}>On this page</h2>
              <nav>
                <ul className={styles.tocNav}>
                  {tocItems.map((item) => {
                    const isActive = activeSection === item.id;
                    return (
                      <li key={item.id}>
                        <a
                          href={`#${item.id}`}
                          className={`${styles.tocLink} ${isActive ? styles.tocLinkActive : ''}`}
                          onClick={(e) => {
                            e.preventDefault();
                            const el = document.getElementById(item.id);
                            if (el) {
                              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              setActiveSection(item.id);
                              history.pushState(null, '', `#${item.id}`);
                            }
                          }}
                        >
                          {item.title}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </aside>
          )}

          {/* Main Content Area */}
          <article className={styles.docContent}>
            {children}

            {/* Quick Legal Navigation Links */}
            <nav className={styles.legalFooterNav} aria-label="Related Legal Links">
              <Link href="/privacy" className={styles.legalFooterLink}>
                {legal.footerLinks.privacy}
              </Link>
              <Link href="/terms" className={styles.legalFooterLink}>
                {legal.footerLinks.terms}
              </Link>
              <Link href="/data-deletion" className={styles.legalFooterLink}>
                {legal.footerLinks.dataDeletion}
              </Link>
              <Link href="/refund-policy" className={styles.legalFooterLink}>
                {legal.footerLinks.refundPolicy}
              </Link>
              <Link href="/support" className={styles.legalFooterLink}>
                {legal.footerLinks.support}
              </Link>
              <Link href="/contact" className={styles.legalFooterLink}>
                {legal.footerLinks.contact}
              </Link>
            </nav>
          </article>
        </div>
      </main>

      {/* Public Footer */}
      <PublicFooter />
    </div>
  );
}
