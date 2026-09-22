'use client';

import { useState } from 'react';
import Link from 'next/link';
import PublicNavbar from '@/app/components/public/PublicNavbar';
import PublicFooter from '@/app/components/public/PublicFooter';
import styles from './founder.module.css';

export default function FounderContent() {
  const [isCardHovered, setIsCardHovered] = useState(false);

  return (
    <div className={styles.founderRoot}>
      {/* Top Navbar */}
      <PublicNavbar isFounderPage={true} />

      {/* Ambient Canvas Lighting */}
      <div className={styles.bgGlowTop} aria-hidden="true" />
      <div className={styles.bgGlowMid} aria-hidden="true" />

      {/* ===================================================================
          1. HERO SECTION
          =================================================================== */}
      <section className={styles.heroSection}>
        <div className={styles.container}>
          <div className={styles.heroGrid}>
            
            {/* Left: Engineering Pitch & Credentials */}
            <div className={styles.heroContent}>
              <div className={styles.eyebrowBadge}>
                <span className={styles.eyebrowDot} />
                <span>Full-Stack &amp; AI Integration Developer</span>
              </div>

              <h1 className={styles.heroName}>Mubassir</h1>
              <p className={styles.heroRoleTag}>Full-Stack Developer | Python, APIs &amp; AI Integration</p>

              <p className={styles.heroPitch}>
                I designed, built, and deployed Siffty, a production Instagram DM automation SaaS, end to end.
              </p>

              {/* 4 Quick Stat Chips */}
              <div className={styles.heroPillList}>
                <div className={styles.credentialPill}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>Solo-Built SaaS</span>
                </div>

                <div className={styles.credentialPill}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                  <span>Meta Graph API</span>
                </div>

                <div className={styles.credentialPill}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                  </svg>
                  <span>Production Deployed</span>
                </div>

                <div className={styles.credentialPill}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  <span>Full-Stack Architecture</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className={styles.heroCtaGroup}>
                <a
                  href="https://www.linkedin.com/in/mubassir-shah/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.btnPillDark}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.2a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3Z" />
                  </svg>
                  <span>LinkedIn Profile</span>
                </a>

                <a
                  href="https://github.com/dev-mubassir"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.btnPillSecondary}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2Z" />
                  </svg>
                  <span>GitHub</span>
                </a>

                <a
                  href="mailto:mubassirrr2005@gmail.com"
                  className={styles.btnPillSecondary}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <span>Contact Me</span>
                </a>
              </div>

              <Link href="/register" className={styles.secondaryLink}>
                <span>Try Siffty live demo</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            </div>

            {/* Right: Framer Team Hover Card Component */}
            <div className={styles.cardColumn}>
              <div
                className={`${styles.framerCardWrapper} ${isCardHovered ? styles.isActive : ''}`}
                onMouseEnter={() => setIsCardHovered(true)}
                onMouseLeave={() => setIsCardHovered(false)}
                onClick={() => setIsCardHovered((prev) => !prev)}
                tabIndex={0}
                role="region"
                aria-label="Developer Interactive Card"
              >
                {/* Backplate Gradient Plate */}
                <div className={styles.cardBgBackplate}>
                  <div className={styles.cardGlowCircle} />
                </div>

                {/* Layered Portrait Cutouts */}
                <div className={styles.portraitWrapper}>
                  {/* Default State: White T-Shirt Cutout */}
                  <img
                    src="/assets/founder-white-shirt.png"
                    alt="Mubassir — Full-Stack Developer"
                    className={`${styles.portraitImg} ${styles.portraitDefault}`}
                    width="809"
                    height="1024"
                    loading="eager"
                  />

                  {/* Hover State: Black Spider T-Shirt Cutout */}
                  <img
                    src="/assets/founder-black-shirt.png"
                    alt="Mubassir — In Dev Mode"
                    className={`${styles.portraitImg} ${styles.portraitHover}`}
                    width="745"
                    height="1024"
                    loading="lazy"
                  />
                </div>

                {/* Floating Frosted Glass Bio Plate */}
                <div className={styles.floatingBioPlate}>
                  <div className={styles.bioHeader}>
                    <div className={styles.bioNameCol}>
                      <h3 className={styles.founderName}>Mubassir</h3>
                      <p className={styles.founderRole}>Full-Stack &amp; AI Developer</p>
                    </div>

                    <a
                      href="https://www.linkedin.com/in/mubassir-shah/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.bioSocialBtn}
                      aria-label="Connect on LinkedIn"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.2a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3Z" />
                      </svg>
                    </a>
                  </div>

                  {/* Expandable Bio Text on Hover */}
                  <div className={styles.expandableBio}>
                    <p className={styles.bioText}>
                      Built &amp; deployed Siffty end to end. Specializing in Node.js, Next.js, PostgreSQL, Meta Graph APIs, and LLM integrations.
                    </p>
                  </div>
                </div>
              </div>

              {/* Hover / Tap Hint */}
              <div className={styles.hoverCue}>
                <span>✨</span> Hover card to reveal dev mode &amp; bio
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ===================================================================
          2. WHAT I BUILT (SHORT CASE STUDY)
          =================================================================== */}
      <section className={`${styles.sectionPadding} ${styles.sectionBorderTop}`}>
        <div className={styles.container}>
          <div className={`${styles.sectionHeader} ${styles.textCenter}`}>
            <div className={styles.eyebrowBadge}>Case Study</div>
            <h2 className={styles.sectionTitle}>What I built: Siffty</h2>
            <p className={styles.sectionSubtitle}>
              An automated direct messaging workspace built specifically for high-volume Instagram accounts.
            </p>
          </div>

          <div className={styles.caseStudyCard}>
            <div className={styles.caseStudyBody}>
              <p className={styles.caseStudyParagraph}>
                <strong>The Problem:</strong> High-volume Instagram creators, video editors, and agencies receive hundreds of direct messages every day, causing high-value customer inquiries, brand collaborations, and sponsorship requests to get buried under routine spam.
              </p>
              <p className={styles.caseStudyParagraph}>
                <strong>The Solution:</strong> I built Siffty — an Instagram DM workspace featuring a unified multi-column inbox, sub-second neural intent detection (Lead, Brand Deal, High Priority), and fail-closed AI draft replies grounded strictly in a user-defined knowledge base.
              </p>
              <p className={styles.caseStudyParagraph}>
                <strong>The Engineering Scope:</strong> I designed, coded, and deployed the entire system solo — handling Meta Graph API integration, PostgreSQL schema design, HMAC webhook verification, rate-limit backoffs, and cloud deployment.
              </p>
            </div>

            {/* Quick Metrics */}
            <div className={styles.caseStudyMetricsGrid}>
              <div className={styles.metricCard}>
                <div className={styles.metricValue}>100%</div>
                <div className={styles.metricLabel}>Solo Engineered</div>
              </div>
              <div className={styles.metricCard}>
                <div className={styles.metricValue}>0%</div>
                <div className={styles.metricLabel}>Message Loss Webhooks</div>
              </div>
              <div className={styles.metricCard}>
                <div className={styles.metricValue}>&lt;100ms</div>
                <div className={styles.metricLabel}>Intent Classification</div>
              </div>
              <div className={styles.metricCard}>
                <div className={styles.metricValue}>Fail-Closed</div>
                <div className={styles.metricLabel}>Safety Architecture</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================================
          3. ARCHITECTURE & KEY ENGINEERING DECISIONS
          =================================================================== */}
      <section className={`${styles.sectionPadding} ${styles.sectionBorderTop}`}>
        <div className={styles.container}>
          <div className={`${styles.sectionHeader} ${styles.textCenter}`}>
            <div className={styles.eyebrowBadge}>Engineering Deep Dive</div>
            <h2 className={styles.sectionTitle}>Architecture &amp; key decisions</h2>
            <p className={styles.sectionSubtitle}>
              Technical challenges encountered while building Siffty, the solutions implemented, and the measured results.
            </p>
          </div>

          {/* Architecture Flow Strip */}
          <div className={styles.archFlowWrapper}>
            <div className={styles.archNode}>
              <div className={styles.archNodeIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <span className={styles.archNodeTitle}>Next.js 16 UI</span>
              <span className={styles.archNodeSub}>App Router &amp; React 19</span>
            </div>

            <span className={styles.archArrow}>&rarr;</span>

            <div className={styles.archNode}>
              <div className={styles.archNodeIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <span className={styles.archNodeTitle}>Node / Express API</span>
              <span className={styles.archNodeSub}>REST &amp; Auth Gateway</span>
            </div>

            <span className={styles.archArrow}>&rarr;</span>

            <div className={styles.archNode}>
              <div className={styles.archNodeIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <span className={styles.archNodeTitle}>Webhook Pipeline</span>
              <span className={styles.archNodeSub}>HMAC-SHA256 Verification</span>
            </div>

            <span className={styles.archArrow}>&rarr;</span>

            <div className={styles.archNode}>
              <div className={styles.archNodeIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              </div>
              <span className={styles.archNodeTitle}>PostgreSQL</span>
              <span className={styles.archNodeSub}>Composite Indexes</span>
            </div>

            <span className={styles.archArrow}>&rarr;</span>

            <div className={styles.archNode}>
              <div className={styles.archNodeIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </div>
              <span className={styles.archNodeTitle}>AI Grounding Engine</span>
              <span className={styles.archNodeSub}>Fail-Closed Drafts</span>
            </div>
          </div>

          {/* Challenge -> What I Did -> Result Cards */}
          <div className={styles.decisionsGrid}>
            
            {/* Decision 1 */}
            <div className={styles.decisionCard}>
              <div className={styles.decisionCardHeader}>
                <div className={styles.decisionIconWrap}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <h3 className={styles.decisionCardTitle}>Meta Webhook Security &amp; Tamper Resistance</h3>
              </div>

              <div className={styles.decisionBlock}>
                <div className={styles.decisionItem}>
                  <span className={styles.badgeChallenge}>Challenge</span>
                  <p className={styles.decisionItemText}>
                    Instagram webhook endpoints are public HTTP targets vulnerable to replay attacks, payload spoofing, and forged messaging events.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeAction}>What I Did</span>
                  <p className={styles.decisionItemText}>
                    Implemented strict HMAC-SHA256 signature verification validating <code>x-hub-signature-256</code> against raw request buffers before payload parsing, rejecting unverified requests instantly.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeResult}>Result</span>
                  <p className={styles.decisionItemText}>
                    Cryptographically verified incoming message events with zero spoofed or injected messages.
                  </p>
                </div>
              </div>
            </div>

            {/* Decision 2 */}
            <div className={styles.decisionCard}>
              <div className={styles.decisionCardHeader}>
                <div className={styles.decisionIconWrap}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 14 14" />
                  </svg>
                </div>
                <h3 className={styles.decisionCardTitle}>Token Lifecycle &amp; Automated 60-Day Refresh</h3>
              </div>

              <div className={styles.decisionBlock}>
                <div className={styles.decisionItem}>
                  <span className={styles.badgeChallenge}>Challenge</span>
                  <p className={styles.decisionItemText}>
                    Default Instagram user access tokens expire after 1–2 hours, which would disrupt background DM syncing and force repetitive user logins.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeAction}>What I Did</span>
                  <p className={styles.decisionItemText}>
                    Built an automated token exchange pipeline that trades short-lived tokens for 60-day long-lived access tokens via Meta OAuth endpoints, coupled with proactive background refresh workers.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeResult}>Result</span>
                  <p className={styles.decisionItemText}>
                    Zero session dropouts and continuous background message indexing for connected accounts.
                  </p>
                </div>
              </div>
            </div>

            {/* Decision 3 */}
            <div className={styles.decisionCard}>
              <div className={styles.decisionCardHeader}>
                <div className={styles.decisionIconWrap}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </div>
                <h3 className={styles.decisionCardTitle}>Multi-Tenant Data Modeling &amp; Sub-20ms Queries</h3>
              </div>

              <div className={styles.decisionBlock}>
                <div className={styles.decisionItem}>
                  <span className={styles.badgeChallenge}>Challenge</span>
                  <p className={styles.decisionItemText}>
                    Storing tens of thousands of messages, conversation threads, and contact states across multi-tenant accounts caused slow inbox rendering and pagination lag.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeAction}>What I Did</span>
                  <p className={styles.decisionItemText}>
                    Designed a normalized PostgreSQL schema with composite indexes on <code>(account_id, thread_id, timestamp)</code> and transactional updates for unread counts and intent tags.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeResult}>Result</span>
                  <p className={styles.decisionItemText}>
                    Sub-20ms query performance on high-volume inboxes with guaranteed ACID data integrity.
                  </p>
                </div>
              </div>
            </div>

            {/* Decision 4 */}
            <div className={styles.decisionCard}>
              <div className={styles.decisionCardHeader}>
                <div className={styles.decisionIconWrap}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <h3 className={styles.decisionCardTitle}>Unreliable Third-Party APIs &amp; Rate-Limit Pacing</h3>
              </div>

              <div className={styles.decisionBlock}>
                <div className={styles.decisionItem}>
                  <span className={styles.badgeChallenge}>Challenge</span>
                  <p className={styles.decisionItemText}>
                    Meta enforces strict API rate limits and sporadic network dropouts; burst sending risks account restrictions or dropped messages.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeAction}>What I Did</span>
                  <p className={styles.decisionItemText}>
                    Engineered an asynchronous worker queue with exponential backoff (jitter), cooling-off intervals, and a strict fail-closed boundary that halts automated sends if API confidence dips.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeResult}>Result</span>
                  <p className={styles.decisionItemText}>
                    Zero Instagram rate-limit violations, resilient network fault tolerance, and safe message pacing.
                  </p>
                </div>
              </div>
            </div>

            {/* Decision 5 */}
            <div className={styles.decisionCard}>
              <div className={styles.decisionCardHeader}>
                <div className={styles.decisionIconWrap}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                  </svg>
                </div>
                <h3 className={styles.decisionCardTitle}>Production Deployment, DNS &amp; Process Supervision</h3>
              </div>

              <div className={styles.decisionBlock}>
                <div className={styles.decisionItem}>
                  <span className={styles.badgeChallenge}>Challenge</span>
                  <p className={styles.decisionItemText}>
                    Transitioning from local development to a reliable production infrastructure with 24/7 uptime, SSL certificates, and isolated secret management.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeAction}>What I Did</span>
                  <p className={styles.decisionItemText}>
                    Deployed backend services using PM2 cluster supervision on a cloud instance, configured reverse proxy with automatic TLS/SSL renewal, DNS routing, and separated production secrets from code.
                  </p>
                </div>

                <div className={styles.decisionItem}>
                  <span className={styles.badgeResult}>Result</span>
                  <p className={styles.decisionItemText}>
                    High availability with zero-downtime reloads, encrypted in-transit traffic, and reliable production operations.
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ===================================================================
          4. TECH STACK (REAL CODEBASE TECHNOLOGIES)
          =================================================================== */}
      <section className={`${styles.sectionPadding} ${styles.sectionBorderTop}`}>
        <div className={styles.container}>
          <div className={`${styles.sectionHeader} ${styles.textCenter}`}>
            <div className={styles.eyebrowBadge}>Stack</div>
            <h2 className={styles.sectionTitle}>Technologies used</h2>
            <p className={styles.sectionSubtitle}>
              The concrete libraries, frameworks, and protocols powering Siffty in production.
            </p>
          </div>

          <div className={styles.techStackGrid}>
            
            {/* Frontend */}
            <div className={styles.techStackCategoryCard}>
              <div className={styles.techCategoryHeader}>
                <div className={styles.techCategoryIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <h3 className={styles.techCategoryTitle}>Frontend</h3>
              </div>
              <div className={styles.techBadgeList}>
                <span className={styles.techBadge}>Next.js 16 (App Router)</span>
                <span className={styles.techBadge}>React 19</span>
                <span className={styles.techBadge}>Vanilla CSS Modules</span>
                <span className={styles.techBadge}>Framer Motion</span>
                <span className={styles.techBadge}>Responsive Design</span>
              </div>
            </div>

            {/* Backend */}
            <div className={styles.techStackCategoryCard}>
              <div className={styles.techCategoryHeader}>
                <div className={styles.techCategoryIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </div>
                <h3 className={styles.techCategoryTitle}>Backend</h3>
              </div>
              <div className={styles.techBadgeList}>
                <span className={styles.techBadge}>Node.js</span>
                <span className={styles.techBadge}>Express.js</span>
                <span className={styles.techBadge}>RESTful APIs</span>
                <span className={styles.techBadge}>Python (Scripts &amp; Automation)</span>
                <span className={styles.techBadge}>HTTP-only Cookies &amp; JWT</span>
              </div>
            </div>

            {/* Database */}
            <div className={styles.techStackCategoryCard}>
              <div className={styles.techCategoryHeader}>
                <div className={styles.techCategoryIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </div>
                <h3 className={styles.techCategoryTitle}>Database</h3>
              </div>
              <div className={styles.techBadgeList}>
                <span className={styles.techBadge}>PostgreSQL</span>
                <span className={styles.techBadge}>Relational Schema Design</span>
                <span className={styles.techBadge}>Connection Pooling</span>
                <span className={styles.techBadge}>Composite B-Tree Indexes</span>
                <span className={styles.techBadge}>ACID Transactions</span>
              </div>
            </div>

            {/* APIs & Integrations */}
            <div className={styles.techStackCategoryCard}>
              <div className={styles.techCategoryHeader}>
                <div className={styles.techCategoryIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                </div>
                <h3 className={styles.techCategoryTitle}>APIs &amp; Integrations</h3>
              </div>
              <div className={styles.techBadgeList}>
                <span className={styles.techBadge}>Instagram Graph API</span>
                <span className={styles.techBadge}>Instagram Messaging API</span>
                <span className={styles.techBadge}>Meta Webhooks (HMAC-SHA256)</span>
                <span className={styles.techBadge}>Facebook Login OAuth 2.0</span>
                <span className={styles.techBadge}>Long-Lived Token Exchange</span>
              </div>
            </div>

            {/* AI & Prompting */}
            <div className={styles.techStackCategoryCard}>
              <div className={styles.techCategoryHeader}>
                <div className={styles.techCategoryIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </svg>
                </div>
                <h3 className={styles.techCategoryTitle}>AI &amp; Tools</h3>
              </div>
              <div className={styles.techBadgeList}>
                <span className={styles.techBadge}>LLM API Integration</span>
                <span className={styles.techBadge}>Intent Classification</span>
                <span className={styles.techBadge}>Grounded Knowledge Retrieval</span>
                <span className={styles.techBadge}>Claude &amp; Antigravity (Dev Accelerator)</span>
                <span className={styles.techBadge}>Fail-Closed Safeguards</span>
              </div>
            </div>

            {/* DevOps & Tools */}
            <div className={styles.techStackCategoryCard}>
              <div className={styles.techCategoryHeader}>
                <div className={styles.techCategoryIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                  </svg>
                </div>
                <h3 className={styles.techCategoryTitle}>DevOps &amp; Tools</h3>
              </div>
              <div className={styles.techBadgeList}>
                <span className={styles.techBadge}>Linux / Ubuntu VPS</span>
                <span className={styles.techBadge}>PM2 Process Supervisor</span>
                <span className={styles.techBadge}>Git &amp; GitHub</span>
                <span className={styles.techBadge}>Vercel (Frontend Hosting)</span>
                <span className={styles.techBadge}>DNS &amp; TLS/SSL Encryption</span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ===================================================================
          5. HOW I WORK
          =================================================================== */}
      <section className={`${styles.sectionPadding} ${styles.sectionBorderTop}`}>
        <div className={styles.container}>
          <div className={`${styles.sectionHeader} ${styles.textCenter}`}>
            <div className={styles.eyebrowBadge}>Methodology</div>
            <h2 className={styles.sectionTitle}>How I work</h2>
            <p className={styles.sectionSubtitle}>
              My development philosophy focuses on velocity, verification, and practical engineering rigor.
            </p>
          </div>

          <div className={styles.howIWorkGrid}>
            
            <div className={styles.howIWorkCard}>
              <div className={styles.howIWorkIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h3 className={styles.howIWorkTitle}>Learn by shipping</h3>
              <p className={styles.howIWorkBody}>
                I don&apos;t wait to learn everything in theory before starting. I define the target constraint, read the technical documentation, write functional code, and stress-test it against production realities.
              </p>
            </div>

            <div className={styles.howIWorkCard}>
              <div className={styles.howIWorkIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h3 className={styles.howIWorkTitle}>Debug from the payload up</h3>
              <p className={styles.howIWorkBody}>
                When APIs fail or latency spikes, I inspect raw webhook headers, query execution plans, and server logs. Finding root causes quickly beats guessing every time.
              </p>
            </div>

            <div className={styles.howIWorkCard}>
              <div className={styles.howIWorkIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="12 2 2 7 12 12 22 7 12 2" />
                  <polyline points="2 17 12 22 22 17" />
                  <polyline points="2 12 12 17 22 12" />
                </svg>
              </div>
              <h3 className={styles.howIWorkTitle}>AI-augmented, human-verified</h3>
              <p className={styles.howIWorkBody}>
                I treat modern AI tools like Claude and Antigravity as force multipliers for rapid boilerplate, edge-case analysis, and UI iteration — while personally auditing, validating, and taking complete architectural accountability for every line shipped.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ===================================================================
          6. BUILD TIMELINE (6 ONE-LINE MILESTONES)
          =================================================================== */}
      <section className={`${styles.sectionPadding} ${styles.sectionBorderTop}`}>
        <div className={styles.narrowContainer}>
          <div className={`${styles.sectionHeader} ${styles.textCenter}`}>
            <div className={styles.eyebrowBadge}>Timeline</div>
            <h2 className={styles.sectionTitle}>Build progression</h2>
            <p className={styles.sectionSubtitle}>
              Key milestones across the six-month development journey.
            </p>
          </div>

          <div className={styles.timelineWrapper}>
            <div className={styles.timelineTrack} />

            {/* Month 1 */}
            <div className={styles.timelineItem}>
              <div className={styles.timelineDot}>
                <div className={styles.timelineDotInner} />
              </div>
              <div className={styles.timelineCard}>
                <div className={styles.timelineLeft}>
                  <span className={styles.timelineMonth}>Month 1</span>
                  <h3 className={styles.timelineHeadline}>Researched Instagram creator DM workflows and designed the initial architectural blueprint.</h3>
                </div>
                <span className={styles.timelineBadge}>Architecture</span>
              </div>
            </div>

            {/* Month 2 */}
            <div className={styles.timelineItem}>
              <div className={styles.timelineDot}>
                <div className={styles.timelineDotInner} />
              </div>
              <div className={styles.timelineCard}>
                <div className={styles.timelineLeft}>
                  <span className={styles.timelineMonth}>Month 2</span>
                  <h3 className={styles.timelineHeadline}>Built the core Express REST APIs, PostgreSQL relational schema, and secure authentication.</h3>
                </div>
                <span className={styles.timelineBadge}>Backend Core</span>
              </div>
            </div>

            {/* Month 3 */}
            <div className={styles.timelineItem}>
              <div className={styles.timelineDot}>
                <div className={styles.timelineDotInner} />
              </div>
              <div className={styles.timelineCard}>
                <div className={styles.timelineLeft}>
                  <span className={styles.timelineMonth}>Month 3</span>
                  <h3 className={styles.timelineHeadline}>Configured Meta developer app, OAuth login, 60-day token rotation, and HMAC-SHA256 webhooks.</h3>
                </div>
                <span className={styles.timelineBadge}>Meta APIs</span>
              </div>
            </div>

            {/* Month 4 */}
            <div className={styles.timelineItem}>
              <div className={styles.timelineDot}>
                <div className={styles.timelineDotInner} />
              </div>
              <div className={styles.timelineCard}>
                <div className={styles.timelineLeft}>
                  <span className={styles.timelineMonth}>Month 4</span>
                  <h3 className={styles.timelineHeadline}>Developed the Next.js multi-column inbox, neural intent detection tags, and AI draft engine.</h3>
                </div>
                <span className={styles.timelineBadge}>Inbox &amp; AI</span>
              </div>
            </div>

            {/* Month 5 */}
            <div className={styles.timelineItem}>
              <div className={styles.timelineDot}>
                <div className={styles.timelineDotInner} />
              </div>
              <div className={styles.timelineCard}>
                <div className={styles.timelineLeft}>
                  <span className={styles.timelineMonth}>Month 5</span>
                  <h3 className={styles.timelineHeadline}>Deployed backend on cloud instance with PM2, automated SSL, DNS routing, and error backoffs.</h3>
                </div>
                <span className={styles.timelineBadge}>Deployment</span>
              </div>
            </div>

            {/* Month 6 */}
            <div className={styles.timelineItem}>
              <div className={styles.timelineDot}>
                <div className={styles.timelineDotInner} />
              </div>
              <div className={styles.timelineCard}>
                <div className={styles.timelineLeft}>
                  <span className={styles.timelineMonth}>Month 6</span>
                  <h3 className={styles.timelineHeadline}>Refined landing page, mobile responsiveness, fail-closed boundaries, and launch preparation.</h3>
                </div>
                <span className={styles.timelineBadge}>Launch</span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ===================================================================
          7. CLOSING CTA (RECRUITER & TECH LEAD PITCH)
          =================================================================== */}
      <section className={`${styles.sectionPadding} ${styles.sectionBorderTop}`}>
        <div className={styles.container}>
          <div className={styles.closingWrapper}>
            <div className={styles.eyebrowBadge} style={{ marginBottom: '16px' }}>Let&apos;s Connect</div>
            <h2 className={styles.closingTitle}>Open to internships &amp; junior developer roles</h2>
            
            <p className={styles.closingText}>
              Looking for a proactive full-stack or AI-focused software engineer who can take an idea from architectural design to a live, scalable product? I&apos;m ready to contribute immediately.
            </p>

            <div className={styles.socialGrid}>
              {/* Email */}
              <a
                href="mailto:mubassirrr2005@gmail.com"
                className={styles.socialCard}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <span>mubassirrr2005@gmail.com</span>
              </a>

              {/* LinkedIn */}
              <a
                href="https://www.linkedin.com/in/mubassir-shah/"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialCard}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.2a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3Z" />
                </svg>
                <span>LinkedIn Profile</span>
              </a>

              {/* GitHub */}
              <a
                href="https://github.com/dev-mubassir"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialCard}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2Z" />
                </svg>
                <span>GitHub</span>
              </a>
            </div>

            <div className={styles.actionButtonGroup}>
              <a
                href="mailto:mubassirrr2005@gmail.com"
                className={styles.btnPillDark}
              >
                <span>Schedule an Interview</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </a>
              <Link href="/register" className={styles.btnPillSecondary}>
                <span>Explore Siffty Live</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Existing Footer */}
      <PublicFooter />
    </div>
  );
}
