import Link from 'next/link';
import styles from './public.module.css';

export default function PublicFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className={styles.publicFooter}>
      <div className={styles.footerTop}>
        {/* Brand column */}
        <div className={styles.footerBrandCol}>
          <Link href="/" className={styles.brandLogo}>
            <img
              src="/assets/siffty-logo-tight.png"
              alt="Siffty Logo"
              className={styles.brandLogoImg}
              width="40"
              height="40"
            />
            <span className={styles.logoText}>Siffty</span>
          </Link>
          <p className={styles.footerBrandDesc}>
            Siffty reads, understands and organizes your Instagram DMs so you can spend less time sorting and more time on the conversations that matter.
          </p>
          <div style={{ marginTop: '6px' }}>
            <img
              src="/assets/meta-certified-siffty.png"
              alt="Certified by Meta as a Verified Tech Provider"
              className={styles.footerMetaBadge}
            />
          </div>
        </div>

        {/* Links columns */}
        <div className={styles.footerLinksGrid}>
          {/* Col 1: Product */}
          <div>
            <h4 className={styles.footerColTitle}>Product</h4>
            <ul className={styles.footerLinksList}>
              <li><Link href="/#hero">Overview</Link></li>
              <li><Link href="/#capabilities">Capabilities</Link></li>
              <li><Link href="/#features">Features</Link></li>
              <li><Link href="/#pricing">Pricing</Link></li>
            </ul>
          </div>

          {/* Col 2: Resources */}
          <div>
            <h4 className={styles.footerColTitle}>Resources</h4>
            <ul className={styles.footerLinksList}>
              <li><Link href="/how-to-use">How to use</Link></li>
              <li><Link href="/founder-developer">Founder &amp; Developer</Link></li>
              <li><Link href="/support">Support</Link></li>
              <li><Link href="/contact">Contact</Link></li>
            </ul>
          </div>

          {/* Col 3: Legal */}
          <div>
            <h4 className={styles.footerColTitle}>Legal</h4>
            <ul className={styles.footerLinksList}>
              <li><Link href="/privacy">Privacy policy</Link></li>
              <li><Link href="/terms">Terms of service</Link></li>
              <li><Link href="/data-deletion">Delete your data</Link></li>
              <li><Link href="/refund-policy">Refund policy</Link></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Footer Bottom Row */}
      <div className={styles.footerBottom}>
        <p style={{ margin: 0 }}>&copy; {currentYear} Siffty. All rights reserved.</p>
        <p style={{ margin: 0 }}>Built with the official Instagram Graph API.</p>
      </div>
    </footer>
  );
}
