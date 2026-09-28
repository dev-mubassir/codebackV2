'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
// Imported here rather than in the root layout: 5,553 lines of landing styles
// were shipping on every page in the product, including /inbox and /dashboard.
import './landing.css';
import { getMe } from '@/lib/api';
import { errors } from '@/content/copy';
import AutoDmShowcase from '@/app/components/landing/AutoDmShowcase';
import { useAutoDmAvailability, comingSoonProps } from '@/lib/autodmAvailability';
import { autodmPlanRow } from '@/content/autodmPlans';

function LandingPageContent() {
  const autodmAvailable = useAutoDmAvailability();
  const autodmSoon = comingSoonProps(autodmAvailable);
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get('error');
  const oauthError = errorCode ? (errors.oauthCallback[errorCode] || errors.oauthCallback.generic) : '';

  // 0. Full-Screen Preloader Animation State (runs on every visit / reload)
  const [preloaderComplete, setPreloaderComplete] = useState(false);
  const [preloaderExiting, setPreloaderExiting] = useState(false);
  const [loadingPercent, setLoadingPercent] = useState(0);

  useEffect(() => {
    // Disable scrolling while preloader is visible
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    let animationFrameId;
    const duration = 1350; // Smooth 1.35s intentional pacing
    const startTime = performance.now();

    const updateProgress = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Smooth custom easing: 0% -> 10% -> 20% -> ... -> 100%
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      const currentVal = Math.min(Math.round(eased * 100), 100);
      setLoadingPercent(currentVal);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(updateProgress);
      } else {
        // Hold 100% very briefly (180ms), then execute polished upward wipe transition
        setTimeout(() => {
          setPreloaderExiting(true);
          // Restore scrolling immediately as preloader begins exit transition
          document.body.style.overflow = '';
          document.documentElement.style.overflow = '';

          setTimeout(() => {
            setPreloaderComplete(true);
          }, 800);
        }, 180);
      }
    };

    animationFrameId = requestAnimationFrame(updateProgress);

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, []);

  // 1. Sticky Navbar State
  const [isScrolled, setIsScrolled] = useState(false);

  // 2. Mobile Drawer State
  const [mobileOpen, setMobileOpen] = useState(false);

  // 3. Business Showcase Loop State
  const [activeCard, setActiveCard] = useState(0);
  const isCardPausedRef = useRef(false);
  const cardLoopTimerRef = useRef(null);
  const cardResumeTimeoutRef = useRef(null);

  // 4. FAQ Accordion State
  const [activeFaq, setActiveFaq] = useState(0);

  // 5. Canvas Ref for Animated Footer Grid
  const canvasRef = useRef(null);
  const footerRef = useRef(null);

  // 6. Workflow Step 03 Card Action State
  const [replyUsed, setReplyUsed] = useState(false);
  const handleUseReply = () => {
    setReplyUsed(true);
    setTimeout(() => {
      setReplyUsed(false);
    }, 2200);
  };

  // Authentication check & clean up URL query params
  useEffect(() => {
    if (searchParams.get('error')) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    // Non-blocking auth check — redirect already authenticated users to dashboard
    getMe()
      .then((user) => {
        if (!user.onboardingCompleted) {
          router.push('/onboarding');
        } else {
          router.push('/dashboard');
        }
      })
      .catch(() => {
        // Visitor is not logged in, proceed on landing page
      });
  }, [router, searchParams]);

  // Sticky Navbar Scroll Listener
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 24) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Business Showcase Carousel Loop
  const startCardLoop = useCallback(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    if (cardLoopTimerRef.current) clearInterval(cardLoopTimerRef.current);
    if (cardResumeTimeoutRef.current) clearTimeout(cardResumeTimeoutRef.current);

    cardLoopTimerRef.current = setInterval(() => {
      if (!isCardPausedRef.current) {
        setActiveCard((prev) => (prev + 1) % 8);
      }
    }, 2800);
  }, []);

  const stopCardLoop = useCallback(() => {
    if (cardLoopTimerRef.current) {
      clearInterval(cardLoopTimerRef.current);
      cardLoopTimerRef.current = null;
    }
    if (cardResumeTimeoutRef.current) {
      clearTimeout(cardResumeTimeoutRef.current);
      cardResumeTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    startCardLoop();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopCardLoop();
      } else if (!isCardPausedRef.current) {
        startCardLoop();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopCardLoop();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [startCardLoop, stopCardLoop]);

  const handleCardMouseEnter = (index) => {
    isCardPausedRef.current = true;
    stopCardLoop();
    setActiveCard(index);
  };

  const handleCardMouseLeave = () => {
    isCardPausedRef.current = false;
    cardResumeTimeoutRef.current = setTimeout(() => {
      startCardLoop();
    }, 1200);
  };

  // Scroll Reveal Animations
  useEffect(() => {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const targets = document.querySelectorAll(
      '.workflow-step-card, .testimonial-card, .pricing-card, .autodm-reveal'
    );

    targets.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
    });

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px 0px' }
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Stacked Cards Scroll Deck for Capabilities Section
  const capabilitiesSectionRef = useRef(null);
  const cardRefs = useRef([]);

  useEffect(() => {
    const section = capabilitiesSectionRef.current;
    if (!section) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const cards = cardRefs.current.filter(Boolean);
    if (cards.length === 0) return;

    const numCards = cards.length;
    let rafId = null;
    let targetProgress = 0;
    let currentProgress = 0;
    let isRunning = false;

    const updateCards = (progress) => {
      const S = progress * (numCards - 1);
      const isMobile = window.innerWidth <= 900;
      const peekOffset = isMobile ? 10 : 28;
      const scaleStep = isMobile ? 0.032 : 0.045;
      const liftDistance = isMobile ? Math.min(400, Math.round(window.innerHeight * 0.55)) : 640;

      cards.forEach((card, i) => {
        if (S < i) {
          // Card is waiting in the stack behind
          const d = i - S;
          const translateY = d * peekOffset;
          const scale = Math.max(0.85, 1 - d * scaleStep);
          const opacity = Math.max(0.4, 1 - d * 0.18);
          const zIndex = (numCards - i) * 10;

          card.style.transform = `translate3d(0, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
          card.style.opacity = opacity.toFixed(3);
          card.style.zIndex = zIndex;
          card.style.pointerEvents = d < 0.25 ? 'auto' : 'none';
        } else {
          // Card is active or lifting upward out of view
          const e = S - i;
          if (e <= 1.15) {
            const liftProgress = Math.min(1, e);
            const easedLift = liftProgress * liftProgress * (3 - 2 * liftProgress);
            const translateY = -easedLift * liftDistance;
            const scale = 1 - easedLift * 0.02;
            const opacity = Math.max(0, 1 - easedLift * 1.35);
            const zIndex = 30 + i;

            card.style.transform = `translate3d(0, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
            card.style.opacity = opacity.toFixed(3);
            card.style.zIndex = zIndex;
            card.style.pointerEvents = e < 0.25 ? 'auto' : 'none';
          } else {
            card.style.transform = `translate3d(0, -${liftDistance}px, 0) scale(0.98)`;
            card.style.opacity = '0';
            card.style.zIndex = '0';
            card.style.pointerEvents = 'none';
          }
        }
      });
    };

    const calculateTargetProgress = () => {
      const rect = section.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const totalScrollableDistance = rect.height - viewportHeight;

      if (totalScrollableDistance <= 0) return 0;

      const scrollOffset = -rect.top;
      const rawProgress = scrollOffset / totalScrollableDistance;
      return Math.max(0, Math.min(1, rawProgress));
    };

    const tick = () => {
      const diff = targetProgress - currentProgress;
      const isMobile = window.innerWidth <= 900;
      const lerpFactor = isMobile ? 0.28 : 0.12;

      if (Math.abs(diff) > 0.0004) {
        currentProgress += diff * lerpFactor;
        updateCards(currentProgress);
        rafId = requestAnimationFrame(tick);
      } else {
        currentProgress = targetProgress;
        updateCards(currentProgress);
        isRunning = false;
        rafId = null;
      }
    };

    const onScroll = () => {
      targetProgress = calculateTargetProgress();
      if (!isRunning) {
        isRunning = true;
        rafId = requestAnimationFrame(tick);
      }
    };

    const onResize = () => {
      targetProgress = calculateTargetProgress();
      currentProgress = targetProgress;
      updateCards(currentProgress);
    };

    targetProgress = calculateTargetProgress();
    currentProgress = targetProgress;
    updateCards(currentProgress);

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Footer Canvas Perspective Grid Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    const footer = footerRef.current;
    if (!canvas || !footer) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let animationFrameId = null;
    let isVisible = false;
    let prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const CYCLE_DURATION = 20000;
    const EXPONENT = 2.2;

    function renderFrame(now) {
      if (width <= 0 || height <= 0) return;

      const vx = width * 0.5;
      const vy = height * 0.38;
      const floorHeight = height - vy;

      ctx.clearRect(0, 0, width, height);

      // Atmospheric vanishing point radial glow
      const glowRadius = Math.min(width * 0.35, 260);
      const glowGrad = ctx.createRadialGradient(vx, vy, 0, vx, vy, glowRadius);
      glowGrad.addColorStop(0, 'rgba(79, 127, 255, 0.045)');
      glowGrad.addColorStop(0.35, 'rgba(118, 87, 255, 0.03)');
      glowGrad.addColorStop(1, 'rgba(248, 249, 251, 0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, width, height);

      // Responsive line density
      let bottomStepX = 52;
      let numHorizLines = 16;
      if (width < 640) {
        bottomStepX = 85;
        numHorizLines = 9;
      } else if (width < 1024) {
        bottomStepX = 66;
        numHorizLines = 12;
      }

      // Diagonal Perspective Lines
      const diagGrad = ctx.createLinearGradient(0, vy, 0, height);
      diagGrad.addColorStop(0, 'rgba(100, 116, 139, 0)');
      diagGrad.addColorStop(0.12, 'rgba(100, 116, 139, 0.04)');
      diagGrad.addColorStop(0.5, 'rgba(100, 116, 139, 0.075)');
      diagGrad.addColorStop(1, 'rgba(100, 116, 139, 0.14)');

      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = diagGrad;

      // Center line
      ctx.moveTo(vx, vy);
      ctx.lineTo(vx, height);

      // Symmetrical lines
      const maxDist = Math.max(vx, width - vx) + width * 0.55;
      for (let offset = bottomStepX; offset <= maxDist; offset += bottomStepX) {
        ctx.moveTo(vx, vy);
        ctx.lineTo(vx + offset, height);

        ctx.moveTo(vx, vy);
        ctx.lineTo(vx - offset, height);
      }
      ctx.stroke();
      ctx.restore();

      // Animated Horizontal Grid Lines
      const cycleProgress = prefersReducedMotion ? 0.35 : ((now % CYCLE_DURATION) / CYCLE_DURATION);

      for (let i = 0; i < numHorizLines; i++) {
        const u = (i / numHorizLines + cycleProgress) % 1;
        const y = vy + floorHeight * Math.pow(u, EXPONENT);

        const horizonFade = Math.min(1, u / 0.14);
        const bottomFade = u > 0.96 ? Math.max(0, (1 - u) / 0.04) : 1;
        const yNorm = (y - vy) / floorHeight;
        const contentFade = 0.5 + 0.5 * Math.pow(yNorm, 1.3);

        const alpha = 0.135 * horizonFade * bottomFade * contentFade;

        if (alpha > 0.005) {
          ctx.beginPath();
          ctx.lineWidth = 1;
          ctx.strokeStyle = `rgba(100, 116, 139, ${alpha.toFixed(4)})`;
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }
      }

      // Horizon Line
      const horizLineGrad = ctx.createLinearGradient(0, 0, width, 0);
      horizLineGrad.addColorStop(0, 'rgba(100, 116, 139, 0.02)');
      horizLineGrad.addColorStop(0.15, 'rgba(100, 116, 139, 0.13)');
      horizLineGrad.addColorStop(0.5, 'rgba(100, 116, 139, 0.16)');
      horizLineGrad.addColorStop(0.85, 'rgba(100, 116, 139, 0.13)');
      horizLineGrad.addColorStop(1, 'rgba(100, 116, 139, 0.02)');

      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = horizLineGrad;
      ctx.moveTo(0, vy);
      ctx.lineTo(width, vy);
      ctx.stroke();
    }

    function tick(now) {
      if (!isVisible || prefersReducedMotion) {
        animationFrameId = null;
        return;
      }
      renderFrame(now);
      animationFrameId = requestAnimationFrame(tick);
    }

    function startLoop() {
      if (prefersReducedMotion) {
        renderFrame(performance.now());
        return;
      }
      if (!animationFrameId && isVisible) {
        animationFrameId = requestAnimationFrame(tick);
      }
    }

    function stopLoop() {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }

    function updateDimensions() {
      const rect = footer.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderFrame(performance.now());
    }

    const resizeObserver = new ResizeObserver(() => updateDimensions());
    resizeObserver.observe(footer);

    const intersectionObserver = new IntersectionObserver((entries) => {
      isVisible = entries[0].isIntersecting;
      if (isVisible) {
        startLoop();
      } else {
        stopLoop();
      }
    }, { threshold: 0.01 });
    intersectionObserver.observe(footer);

    const handleVisibility = () => {
      if (document.hidden) {
        stopLoop();
      } else if (isVisible) {
        startLoop();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMotionChange = (e) => {
      prefersReducedMotion = e.matches;
      if (prefersReducedMotion) {
        stopLoop();
        renderFrame(performance.now());
      } else if (isVisible) {
        startLoop();
      }
    };
    motionQuery.addEventListener('change', handleMotionChange);

    updateDimensions();

    return () => {
      stopLoop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      motionQuery.removeEventListener('change', handleMotionChange);
    };
  }, []);

  const businessCardsData = [
    { title: 'Fashion & clothing', desc: 'Prioritize product questions, orders, sizes, and customer messages.', img: '/assets/usecases/fashion.jpg' },
    { title: 'Beauty & wellness', desc: 'Keep bookings, product questions, and customer conversations organized.', img: '/assets/usecases/beauty.jpg' },
    { title: 'Online store', desc: 'Separate purchase questions, order messages, and high-value conversations.', img: '/assets/usecases/ecommerce.jpg' },
    { title: 'Real estate', desc: 'Prioritize buyer inquiries and serious property conversations.', img: '/assets/usecases/real-estate.jpg' },
    { title: 'Restaurant & café', desc: 'Keep reservations, availability questions, and customer messages visible.', img: '/assets/usecases/restaurant.jpg' },
    { title: 'Fitness & coaching', desc: 'Organize client questions, leads, and booking conversations.', img: '/assets/usecases/fitness.jpg' },
    { title: 'Creator / photographer', desc: 'Separate brand deals, collaboration requests, and audience messages.', img: '/assets/usecases/creator.jpg' },
    { title: 'Agency / freelancer', desc: 'Keep client conversations, leads, and project inquiries organized.', img: '/assets/usecases/agency.jpg' },
  ];

  const faqData = [
    {
      q: 'How does Siffty connect to Instagram?',
      a: 'Siffty connects through the official Meta & Instagram Graph API using OAuth 2.0. We never ask for your account password, and credentials are encrypted at rest using envelope encryption.',
    },
    {
      q: 'How does conversation classification work?',
      a: 'When an inbound DM arrives, our classification engine analyzes the message intent against your business profile (pricing, packages, FAQs). It tags the conversation as Hot Lead, Brand Deal, Support, or General without sending anything until allowed.',
    },
    {
      q: 'Can teams share the inbox?',
      a: 'Yes. Team members can view conversations, assign leads, leave internal notes, and approve drafted replies within the 3-column inbox.',
    },
    {
      q: 'Does Siffty store message data?',
      a: 'Only conversation metadata and messages needed to provide the inbox service are securely stored, strictly tenant-scoped in your workspace. We respect data deletion requests immediately via our public deletion portal.',
    },
    {
      q: 'What permissions are required?',
      a: 'Siffty requests instagram_business_basic and instagram_business_manage_messages. Auto DM additionally requests instagram_business_manage_comments. We never ask for your Instagram password.',
    },
    {
      q: 'What is Auto DM?',
      a: 'Auto DM sends a direct message to people who comment on your posts. You choose which posts and which keywords (or any comment), write the message and add your link, and Siffty sends each commenter a private reply once, through Instagram’s official API. You can require people to follow you before they get the link, and every reply is listed in a run log. Auto DM is being rolled out gradually.',
    },
    {
      q: 'Is automatic reply safe from infinite loops?',
      a: 'Yes. Siffty incorporates anti-loop guards, customer pacing delays, and a fail-closed architecture: if confidence is low or an anomaly is detected, it immediately hands the chat back to a human.',
    },
  ];

  return (
    <div className={`landing-root ${preloaderExiting || preloaderComplete ? 'preloader-done' : ''}`}>
      {/* Full-Screen Premium Preloader */}
      {!preloaderComplete && (
        <aside
          className={`siffty-preloader ${preloaderExiting ? 'preloader-exit' : ''}`}
          aria-label="Loading page"
          role="status"
        >
          <div className="preloader-inner">
            <div className="preloader-percentage-container">
              <span className="preloader-number">{loadingPercent}</span>
              <span className="preloader-symbol">%</span>
            </div>
            <div
              className="preloader-line"
              style={{
                width: `${Math.round(8 + (loadingPercent / 100) * 172)}px`,
              }}
              aria-hidden="true"
            />
          </div>
        </aside>
      )}

      {/* Background decorative grid marks */}
      <div className="bg-grid-overlay" aria-hidden="true" />

      {/* OAuth Error Alert Banner */}
      {oauthError && (
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 110,
          backgroundColor: '#fef2f2',
          borderBottom: '1px solid #fee2e2',
          padding: '12px 24px',
          color: '#991b1b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          fontSize: '14px',
          fontWeight: 500,
        }} role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>{oauthError}</span>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className={`navbar-wrapper ${isScrolled ? 'scrolled' : ''}`} id="navbar">
        <nav className="navbar-container">
          <div className="navbar-left">
            <Link href="/" className="brand-logo" id="brand-logo" aria-label="Siffty Home">
              <img
                src="/assets/siffty-logo-sm.webp"
                alt="Siffty Logo"
                className="brand-logo-img"
                width="48"
                height="48"
              />
            </Link>

            <ul className="nav-links" id="nav-links">
              <li className="nav-item">
                <a href="#features" className="nav-link">Features</a>
              </li>
              <li className="nav-item">
                <a href="#how-it-works" className="nav-link">How it works</a>
              </li>
              <li className="nav-item">
                <a href="#pricing" className="nav-link">Pricing</a>
              </li>
            </ul>
          </div>

          <div className="navbar-right">
            <Link href="/login" className="btn-text" id="btn-signin">
              Sign in
            </Link>
            <Link href="/register" className="btn-pill-dark" id="btn-get-started">
              <span className="btn-text-roll">
                <span className="btn-text-track">
                  <span className="btn-text-line">Get started</span>
                  <span className="btn-text-line" aria-hidden="true">Get started</span>
                </span>
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
            <button
              className={`mobile-toggle-btn ${mobileOpen ? 'is-active' : ''}`}
              id="mobile-toggle"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((prev) => !prev)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </nav>

        {/* Mobile Drawer */}
        <div className={`mobile-drawer ${mobileOpen ? 'active' : ''}`} id="mobile-drawer">
          <div className="mobile-links">
            <a href="#features" className="mobile-nav-link" onClick={() => setMobileOpen(false)}>
              Features
            </a>
            <a href="#how-it-works" className="mobile-nav-link" onClick={() => setMobileOpen(false)}>
              How it works
            </a>
            <a href="#pricing" className="mobile-nav-link" onClick={() => setMobileOpen(false)}>
              Pricing
            </a>
            <div className="mobile-actions">
              <Link href="/login" className="btn-mobile-secondary" onClick={() => setMobileOpen(false)}>
                Sign in
              </Link>
              <Link href="/register" className="btn-pill-dark full-width" onClick={() => setMobileOpen(false)}>
                <span className="btn-text-roll">
                  <span className="btn-text-track">
                    <span className="btn-text-line">Get started</span>
                    <span className="btn-text-line" aria-hidden="true">Get started</span>
                  </span>
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="hero-section" id="hero">
        <div className="hero-container">
          {/* Left Column: Copy & Actions */}
          <div className="hero-left">
            <a href="#capabilities" className="badge-announcement" id="hero-badge">
              <span className="badge-pulse-dot" />
              <span className="badge-text">Introducing Siffty</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </a>

            <h1 className="hero-headline" aria-label="Stop reading every Instagram DM manually.">
              <span className="hero-reveal-mask">
                <span className="hero-reveal-inner hero-reveal-line-1">Stop reading every</span>
              </span>
              <span className="hero-reveal-mask">
                <span className="hero-reveal-inner hero-reveal-line-2 highlight-yellow">Instagram DM</span>
              </span>
              <span className="hero-reveal-mask">
                <span className="hero-reveal-inner hero-reveal-line-3">manually.</span>
              </span>
            </h1>

            <p className="hero-subtitle">
              Siffty reads, understands and organizes your DMs so you can spend less time sorting messages and more time on the conversations that matter.
            </p>

            <div className="hero-cta-group">
              <Link href="/register" className="btn-cta-primary" id="btn-start-trial">
                <span className="btn-text-roll">
                  <span className="btn-text-track">
                    <span className="btn-text-line">Start free trial</span>
                    <span className="btn-text-line" aria-hidden="true">Start free trial</span>
                  </span>
                </span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>

              <a href="#how-it-works" className="btn-cta-secondary" id="btn-how-it-works">
                <span className="btn-text-roll">
                  <span className="btn-text-track">
                    <span className="btn-text-line">See how Siffty works →</span>
                    <span className="btn-text-line" aria-hidden="true">See how Siffty works →</span>
                  </span>
                </span>
              </a>
            </div>

            <div className="hero-security-note">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>No credit card required • Meta Verified Webhooks</span>
            </div>
          </div>

          {/* Right Column: 3D Instagram DM SaaS Illustration */}
          <div className="hero-right">
            <img
              src="/assets/3d2.png"
              alt="Siffty 3D Instagram DM Inbox Intelligence Dashboard"
              className="hero-3d-image"
              width="627"
              height="627"
            />
          </div>
        </div>

        {/* Meta Tech Provider Certification Trust Strip */}
        <div className="meta-certified-center-section" id="meta-certified-badge">
          <div className="meta-trust-strip">
            <img
              src="/assets/meta-tech-provider-tight.png"
              alt="Meta Tech provider"
              className="meta-trust-logo"
              width="96"
              height="34"
            />
            <span className="meta-trust-divider" aria-hidden="true" />
            <span className="meta-trust-text">Siffty has been certified by Meta as a Meta Verified Tech Provider.</span>
          </div>
        </div>
      </main>

      {/* SECTION 1 — PRODUCT WORKFLOW */}
      <section className="workflow-section section-padding" id="how-it-works">
        <div className="section-container">
          <div className="section-header text-center">
            <div className="section-eyebrow">
              <span className="eyebrow-dot" />
              <span>Product workflow</span>
            </div>
            <h2 className="section-title">Three steps from chaotic DMs to closed business</h2>
            <p className="section-subtitle">Automate categorization, response suggestions, and routing without losing authentic human control.</p>
          </div>

          <div className="workflow-steps-grid">
            <div className="workflow-line-track" aria-hidden="true" />

            {/* STEP 01 */}
            <div className="workflow-step-card workflow-step-coded-card" data-step="1">
              <div className="workflow-card-inner">
                <div className="workflow-card-badge" aria-hidden="true">01</div>
                <h3 className="workflow-card-title">Connect your Instagram</h3>
                <p className="workflow-card-subtitle">
                  Link your Instagram account in seconds and keep your inbox always in sync.
                </p>

                <div className="workflow-card1-mockup">
                  <div className="workflow-card1-conn-box">
                    <div className="workflow-card1-node">
                      <img
                        src="/assets/step1-ig-profile.png"
                        alt="Instagram Account"
                        className="workflow-card1-icon"
                        width="44"
                        height="44"
                      />
                      <span className="workflow-card1-node-title">Instagram</span>
                      <span className="workflow-card1-node-sub">@the.travel.diary</span>
                    </div>

                    <div className="workflow-card1-connector">
                      <div className="workflow-card1-line" aria-hidden="true" />
                      <div className="workflow-card1-check" aria-label="Connected">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                      <span className="workflow-card1-pill">Connected</span>
                    </div>

                    <div className="workflow-card1-node">
                      <img
                        src="/assets/step1-siffty-icon.png"
                        alt="Siffty DM Assistant"
                        className="workflow-card1-icon"
                        width="44"
                        height="44"
                      />
                      <span className="workflow-card1-node-title">Siffty</span>
                      <span className="workflow-card1-node-sub">Your DM assistant</span>
                    </div>
                  </div>

                  <div className="workflow-card1-features">
                    <div className="workflow-card1-feature-item">
                      <div className="workflow-card1-feature-icon icon-blue">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>
                      <span className="workflow-card1-feature-label">Sync your conversations</span>
                    </div>

                    <div className="workflow-card1-feature-item">
                      <div className="workflow-card1-feature-icon icon-purple">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      </div>
                      <span className="workflow-card1-feature-label">Get instant insights</span>
                    </div>

                    <div className="workflow-card1-feature-item">
                      <div className="workflow-card1-feature-icon icon-pink">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                          <line x1="7" y1="7" x2="7.01" y2="7" />
                        </svg>
                      </div>
                      <span className="workflow-card1-feature-label">Automatically organize DMs</span>
                    </div>

                    <div className="workflow-card1-feature-item">
                      <div className="workflow-card1-feature-icon icon-green">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      </div>
                      <span className="workflow-card1-feature-label">Manage multiple accounts</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* STEP 02 */}
            <div className="workflow-step-card workflow-step-coded-card" data-step="2">
              <div className="workflow-card-inner">
                <div className="workflow-card-badge" aria-hidden="true">02</div>
                <h3 className="workflow-card-title">AI organizes for you</h3>
                <p className="workflow-card-subtitle">
                  We automatically filter spam, hide low-value messages, and prioritize your important DMs.
                </p>

                <div className="workflow-card2-mockup">
                  {/* Row 1 — Sarah Cooper (High Priority) */}
                  <div className="workflow-card2-row is-highlighted">
                    <img
                      src="/assets/avatar-sarah.png"
                      alt="Sarah Cooper"
                      className="workflow-card2-avatar"
                      width="32"
                      height="32"
                    />
                    <div className="workflow-card2-body">
                      <span className="workflow-card2-name">Sarah Cooper</span>
                      <span className="workflow-card2-snippet">Interested in your 10-Reel package!</span>
                    </div>
                    <div className="workflow-card2-meta">
                      <span className="workflow-card2-time">2m</span>
                      <span className="workflow-card2-tag tag-priority">High Priority</span>
                    </div>
                  </div>

                  {/* Row 2 — Rohan Mehta (Brand Deal) */}
                  <div className="workflow-card2-row">
                    <img
                      src="/assets/avatar-rohan.png"
                      alt="Rohan Mehta"
                      className="workflow-card2-avatar"
                      width="32"
                      height="32"
                    />
                    <div className="workflow-card2-body">
                      <span className="workflow-card2-name">Rohan Mehta</span>
                      <span className="workflow-card2-snippet">Can we collaborate this month?</span>
                    </div>
                    <div className="workflow-card2-meta">
                      <span className="workflow-card2-time">12m</span>
                      <span className="workflow-card2-tag tag-deal">Brand Deal</span>
                    </div>
                  </div>

                  {/* Row 3 — Neha Sharma (Potential Buyer) */}
                  <div className="workflow-card2-row">
                    <img
                      src="/assets/avatar-neha.png"
                      alt="Neha Sharma"
                      className="workflow-card2-avatar"
                      width="32"
                      height="32"
                    />
                    <div className="workflow-card2-body">
                      <span className="workflow-card2-name">Neha Sharma</span>
                      <span className="workflow-card2-snippet">What are your rates?</span>
                    </div>
                    <div className="workflow-card2-meta">
                      <span className="workflow-card2-time">1h</span>
                      <span className="workflow-card2-tag tag-buyer">Potential Buyer</span>
                    </div>
                  </div>

                  {/* Row 4 — fitness.world (Low Priority) */}
                  <div className="workflow-card2-row">
                    <img
                      src="/assets/avatar-fitness.png"
                      alt="fitness.world"
                      className="workflow-card2-avatar"
                      width="32"
                      height="32"
                    />
                    <div className="workflow-card2-body">
                      <span className="workflow-card2-name">fitness.world</span>
                      <span className="workflow-card2-snippet">Check out our page!</span>
                    </div>
                    <div className="workflow-card2-meta">
                      <span className="workflow-card2-time">3h</span>
                      <span className="workflow-card2-tag tag-low">Low Priority</span>
                    </div>
                  </div>

                  {/* Row 5 — insta_giveaway (Spam) */}
                  <div className="workflow-card2-row">
                    <img
                      src="/assets/avatar-giveaway.png"
                      alt="insta_giveaway"
                      className="workflow-card2-avatar"
                      width="32"
                      height="32"
                    />
                    <div className="workflow-card2-body">
                      <span className="workflow-card2-name">insta_giveaway</span>
                      <span className="workflow-card2-snippet">You won a prize! 🎁</span>
                    </div>
                    <div className="workflow-card2-meta">
                      <span className="workflow-card2-time">5h</span>
                      <span className="workflow-card2-tag tag-spam">Spam</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* STEP 03 */}
            <div className="workflow-step-card workflow-step-coded-card" data-step="3">
              <div className="workflow-card-inner">
                <div className="workflow-card-badge" aria-hidden="true">03</div>
                <h3 className="workflow-card-title">Turn conversations into action</h3>
                <p className="workflow-card-subtitle">
                  Get AI-powered replies, assign, add notes, and move deals forward — all in one place.
                </p>

                <div className="workflow-card3-mockup">
                  {/* Contact Header */}
                  <div className="workflow-card3-mockup-header">
                    <img
                      src="/assets/avatar-sarah.png"
                      alt="Sarah Cooper"
                      className="workflow-card3-avatar"
                      width="34"
                      height="34"
                    />
                    <span className="workflow-card3-name">Sarah Cooper</span>
                    <span className="workflow-card3-priority">High Priority</span>
                    <span className="workflow-card3-time">2m ago</span>
                  </div>

                  {/* User Inbound Message Bubble */}
                  <div className="workflow-card3-bubble">
                    Hi! I&apos;d love to book a 10-Reel package for next month. What are the rates and availability?
                  </div>

                  {/* AI Suggestion Box */}
                  <div className="workflow-card3-ai-box">
                    <div className="workflow-card3-ai-header">
                      <svg className="workflow-card3-sparkle" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
                      </svg>
                      <span className="workflow-card3-ai-title">AI Reply Suggestion</span>
                    </div>
                    <p className="workflow-card3-ai-text">
                      Hi Sarah! 👋<br />
                      Thanks for your interest! Our 10-Reel package is ₹45,000 and includes ideation, shooting, and editing. We have availability next month. Would you like me to share the full details?
                    </p>
                  </div>

                  {/* Action Buttons Strip */}
                  <div className="workflow-card3-actions">
                    <button
                      type="button"
                      className={`workflow-card3-btn workflow-card3-btn-primary ${replyUsed ? 'is-active' : ''}`}
                      onClick={handleUseReply}
                      aria-label="Use AI reply suggestion"
                    >
                      {replyUsed ? (
                        <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Applied</span>
                        </>
                      ) : (
                        <>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                          </svg>
                          <span>Use Reply</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      className="workflow-card3-btn workflow-card3-btn-secondary"
                      aria-label="Assign conversation"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      <span>Assign</span>
                    </button>

                    <button
                      type="button"
                      className="workflow-card3-btn workflow-card3-btn-secondary"
                      aria-label="Add note to conversation"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                      <span>Add Note</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AUTO DM — directly after the AI sorting walkthrough (components/landing/AutoDmShowcase.js) */}
      <AutoDmShowcase />

      {/* SECTION 2 — CAPABILITIES */}
      <section 
        className="capabilities-section" 
        id="capabilities"
        ref={capabilitiesSectionRef}
      >
        <div className="capabilities-sticky-stage">
          <div className="section-container">
            <div className="section-header text-center capabilities-sticky-header">
              <div className="section-eyebrow">
                <span className="eyebrow-dot" />
                <span>Capabilities</span>
              </div>
              <h2 className="section-title">A calmer inbox for a busier business.</h2>
              <p className="section-subtitle">Real product tools built specifically for high-volume Instagram direct messaging.</p>
            </div>

            <div className="capabilities-deck-wrapper">
              {/* FEATURE 01 — UNIFIED INBOX */}
              <div 
                className="capability-feature-block"
                ref={(el) => { cardRefs.current[0] = el; }}
              >
                <div className="feature-text-col">
                  <span className="feature-subtitle">Inbox without chaos</span>
                  <h3 className="feature-title">Unified Inbox</h3>
                  <p className="feature-body">Filter across all conversations, unread messages, brand sponsorships, and customer support tickets in a unified 3-column view.</p>
                  <ul className="feature-bullets">
                    <li><span>Realtime unread and priority counters</span></li>
                    <li><span>Zero message loss with background indexing</span></li>
                    <li><span>AI-classified inbox with smart intent sorting</span></li>
                  </ul>
                </div>
                <div className="feature-ui-col">
                  <div className="product-inbox-mockup-frame">
                    <img
                      src="/inbox.png"
                      alt="Siffty Unified Inbox — Inbox without chaos"
                      className="product-inbox-mockup-img"
                      width="1529"
                      height="837"
                      loading="lazy"
                    />
                  </div>
                </div>
              </div>

              {/* FEATURE 02 — AI INTENT DETECTION (Reversed) */}
              <div 
                className="capability-feature-block reverse-layout"
                ref={(el) => { cardRefs.current[1] = el; }}
              >
                <div className="feature-text-col">
                  <span className="feature-subtitle">AI-Powered Intent Intelligence</span>
                  <h3 className="feature-title">AI Intent Detection</h3>
                  <p className="feature-body">Instantly identify buyer readiness, client inquiries, and partnership deals with AI-powered conversation labels and sub-second confidence scoring.</p>
                  <ul className="feature-bullets">
                    <li><span>Calculates purchase readiness in &lt;100ms with neural intent tagging</span></li>
                    <li><span>Custom AI models trained on your packages, pricing, and FAQs</span></li>
                    <li><span>Eliminates manual skimming of 500+ daily messages automatically</span></li>
                  </ul>
                </div>
                <div className="feature-ui-col">
                  <div className="product-inbox-mockup-frame mockup-intent-frame">
                    <img
                      src="/high_buyer_intent.png"
                      alt="AI Intent Detection — High Buyer Intent 98.4% Confidence"
                      className="product-inbox-mockup-img"
                      width="1187"
                      height="844"
                      loading="lazy"
                    />
                  </div>
                </div>
              </div>

              {/* FEATURE 03 — SAFETY GUARDS */}
              <div 
                className="capability-feature-block"
                ref={(el) => { cardRefs.current[2] = el; }}
              >
                <div className="feature-text-col">
                  <span className="feature-subtitle">Follow up automatically</span>
                  <h3 className="feature-title">Safety Guards</h3>
                  <p className="feature-body">Set smart auto-reply boundaries, cooling-off delays, and anti-loop pacing that fail closed safely by default.</p>
                  <ul className="feature-bullets">
                    <li><span>Strict fail-closed architecture protects your brand reputation</span></li>
                    <li><span>Pacing intervals prevent Instagram rate limits or spam flags</span></li>
                    <li><span>Human override button available on every single conversation</span></li>
                  </ul>
                </div>
                <div className="feature-ui-col">
                  <div className="mockup-window glass-card">
                    <div className="window-header">
                      <div className="window-dots">
                        <span className="dot red" />
                        <span className="dot yellow" />
                        <span className="dot green" />
                      </div>
                      <span className="window-title">Safety &amp; Guardrails Architecture</span>
                    </div>
                    <div className="safety-console-box">
                      <div className="safety-status-row">
                        <div className="safety-status-item active">
                          <div className="shield-indicator">🛡️</div>
                          <div>
                            <strong>Anti-Loop Pacing: Active</strong>
                            <span>Throttles repeat triggers to prevent infinite message loops</span>
                          </div>
                          <span className="toggle-pill on">ON</span>
                        </div>
                        <div className="safety-status-item active">
                          <div className="shield-indicator">🔒</div>
                          <div>
                            <strong>Fail-Closed Guard On</strong>
                            <span>Low-confidence inquiries halt auto-send &amp; alert your team</span>
                          </div>
                          <span className="toggle-pill on">ON</span>
                        </div>
                      </div>

                      <div className="safety-metrics-row">
                        <div className="safety-metric-pill">
                          <span className="metric-label">Max Pacing Delay</span>
                          <strong>45s organic interval</strong>
                        </div>
                        <div className="safety-metric-pill">
                          <span className="metric-label">Confidence Floor</span>
                          <strong>85% required to draft</strong>
                        </div>
                        <div className="safety-metric-pill">
                          <span className="metric-label">Meta Webhook HMAC</span>
                          <strong className="text-emerald">SHA-256 Verified</strong>
                        </div>
                      </div>

                      <div className="safety-audit-log">
                        <span className="log-title">Live Safety Audit:</span>
                        <div className="log-line">
                          <span className="log-time">15:32:01</span> User asked for unauthorized 50% discount &rarr; <em>Fail-closed triggered. Escalated to human.</em>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3 — FEATURE GRID (Bento Layout) */}
      <section className="features-section section-padding" id="features">
        <div className="section-container">
          <div className="section-header text-center">
            <div className="section-eyebrow">
              <span className="eyebrow-dot" />
              <span>Core platform</span>
            </div>
            <h2 className="section-title">Your AI replies. Your business. Your rules.</h2>
            <p className="section-subtitle">Give Siffty your products, exact pricing, policies, FAQs, and boundaries — then customize its tone, personality, and response style to match your brand.</p>
          </div>

          <div className="business-showcase-grid" id="business-grid">
            {businessCardsData.map((card, index) => (
              <div
                key={card.title}
                className={`business-card ${activeCard === index ? 'is-active' : ''}`}
                data-card-index={index}
                tabIndex={0}
                role="button"
                aria-label={card.title}
                aria-expanded={activeCard === index ? 'true' : 'false'}
                onMouseEnter={() => handleCardMouseEnter(index)}
                onMouseLeave={handleCardMouseLeave}
                onClick={() => setActiveCard(index)}
                onFocus={() => handleCardMouseEnter(index)}
                onBlur={handleCardMouseLeave}
              >
                <div className="business-card-inner">
                  <div className="business-visual-frame">
                    <img
                      src={card.img}
                      alt={card.title}
                      className="business-visual-img"
                      width="600"
                      height="600"
                      loading="lazy"
                    />
                  </div>
                  <div className="business-text-block">
                    <h3 className="business-title">{card.title}</h3>
                    <p className="business-desc">{card.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 5 — CUSTOMER STORIES */}
      <section className="testimonials-section section-padding" id="stories">
        <div className="section-container">
          <div className="section-header text-center">
            <div className="section-eyebrow">
              <span className="eyebrow-dot" />
              <span>Customer Stories</span>
            </div>
            <h2 className="section-title">Don&apos;t just take our word for it</h2>
            <p className="section-subtitle">How creators, video editors, and engineers run their customer DMs with Siffty.</p>
          </div>

          <div className="testimonials-grid">
            {/* TESTIMONIAL 01: Karan Tiwari */}
            <div className="testimonial-card">
              <div className="quote-icon">“</div>
              <p className="testimonial-quote">“I get dozens of DMs every week asking for AI consulting, freelance builds, or tech collabs. Before Siffty, high-ticket project inquiries were constantly buried under random messages. Now serious clients get qualified instantly, and Siffty shares my booking link while I stay locked in my code editor.”</p>
              <div className="testimonial-author">
                <div className="author-avatar">
                  <img src="/assets/testimonials/karan-tiwari.png" alt="Karan Tiwari" className="author-avatar-img" width="44" height="44" loading="lazy" />
                </div>
                <div className="author-meta">
                  <h4 className="author-name">Karan Tiwari</h4>
                  <span className="author-role">AI Engineer • Tech Consultant</span>
                </div>
              </div>
            </div>

            {/* TESTIMONIAL 02: Akhiraa (Featured) */}
            <div className="testimonial-card featured-testimonial">
              <div className="quote-icon">“</div>
              <p className="testimonial-quote">“As a video editor, my DMs are constantly flooded with &apos;rate per reel?&apos; and rush inquiries. Siffty immediately responds with my exact package pricing, turnaround times, and editing guidelines. It qualifies client budgets before I even open Premiere Pro.”</p>
              <div className="testimonial-author">
                <div className="author-avatar">
                  <img src="/assets/testimonials/akhiraa.png" alt="Akhiraa" className="author-avatar-img" width="44" height="44" loading="lazy" />
                </div>
                <div className="author-meta">
                  <h4 className="author-name">Akhiraa</h4>
                  <span className="author-role">Video Editor • @akhiraa_light</span>
                </div>
              </div>
            </div>

            {/* TESTIMONIAL 03: Adarsh Shriwastri */}
            <div className="testimonial-card">
              <div className="quote-icon">“</div>
              <p className="testimonial-quote">“Motion design projects take intense focus, so checking Instagram DMs every twenty minutes was killing my creative flow. Siffty handles all initial project scope queries and timeline checks automatically without sounding like a robotic bot. Closed two retainer clients last month directly through it.”</p>
              <div className="testimonial-author">
                <div className="author-avatar">
                  <img src="/assets/testimonials/adarsh-shrivastri.png" alt="Adarsh Shriwastri" className="author-avatar-img" width="44" height="44" loading="lazy" />
                </div>
                <div className="author-meta">
                  <h4 className="author-name">Adarsh Shriwastri</h4>
                  <span className="author-role">Motion Designer • 3D Animation</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 6 — FAQ */}
      <section className="faq-section section-padding" id="faq">
        <div className="section-container max-w-3xl">
          <div className="section-header text-center">
            <div className="section-eyebrow">
              <span className="eyebrow-dot" />
              <span>Frequently asked questions</span>
            </div>
            <h2 className="section-title">Everything you need to know about connecting and running Siffty.</h2>
          </div>

          <div className="faq-accordion-group">
            {faqData.map((faq, index) => {
              const isOpen = activeFaq === index;
              return (
                <div key={faq.q} className={`faq-item ${isOpen ? 'active' : ''}`}>
                  <button
                    className="faq-trigger"
                    aria-expanded={isOpen ? 'true' : 'false'}
                    onClick={() => setActiveFaq(isOpen ? null : index)}
                  >
                    <span className="faq-question">{faq.q}</span>
                    <span className="faq-icon-chevron">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                  </button>
                  <div className="faq-content">
                    <p>{faq.a}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SECTION 7 — FINAL CTA */}
      <section className="cta-section section-padding" id="cta">
        <div className="section-container">
          <div className="cta-banner-wrapper">
            {/* Ambient background blue gradient glow */}
            <div className="cta-ambient-glow" aria-hidden="true" />

            {/* Floating UI cards */}
            <div className="floating-cta-card card-top-left" aria-hidden="true">
              <div className="float-lead-chip">
                <span className="float-dot" />
                <strong>@agency.pro</strong>
                <span>“Can you send the contract?”</span>
                <span className="status-pill status-hot">Hot Lead</span>
              </div>
            </div>

            <div className="floating-cta-card card-bottom-right" aria-hidden="true">
              <div className="float-metric-chip">
                <span className="check-icon">✓</span>
                <div>
                  <strong>98.4% Intent Accuracy</strong>
                  <span>Meta Webhook: 24ms delivery</span>
                </div>
              </div>
            </div>

            {/* Center Content */}
            <div className="cta-center-content">
              <div className="cta-pill-badge">
                <span className="eyebrow-dot" />
                <span>Get started in 2 minutes</span>
              </div>

              <h2 className="cta-headline">Stop reading every Instagram DM manually.</h2>

              <p className="cta-description">
                Siffty reads, understands and organizes your DMs so you can spend less time sorting and more time on the conversations that matter.
              </p>

              <div className="cta-actions-group">
                <Link href="/register" className="btn-cta-primary">
                  <span className="btn-text-roll">
                    <span className="btn-text-track">
                      <span className="btn-text-line">Start free trial</span>
                      <span className="btn-text-line" aria-hidden="true">Start free trial</span>
                    </span>
                  </span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>

                <a href="#how-it-works" className="btn-cta-secondary">
                  <span className="btn-text-roll">
                    <span className="btn-text-track">
                      <span className="btn-text-line">See how Siffty works &rarr;</span>
                      <span className="btn-text-line" aria-hidden="true">See how Siffty works &rarr;</span>
                    </span>
                  </span>
                </a>
              </div>

              <div className="cta-security-footnote">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>No credit card required • Official Meta Graph API • Cancel anytime</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 8 — PRICING */}
      <section className="pricing-section section-padding" id="pricing">
        <div className="section-container">
          <div className="section-header text-center">
            <div className="section-eyebrow">
              <span className="eyebrow-dot" />
              <span>Pricing</span>
            </div>
            <h2 className="section-title">One payment, thirty days. Stop whenever you like.</h2>
            <p className="pricing-trial-autodm">
              Your free trial includes Auto DM: {autodmPlanRow('TRIAL')} <span {...autodmSoon}>Coming soon</span>
            </p>
          </div>

          <div className="pricing-grid">
            {/* STARTER */}
            <div className="pricing-card">
              <div className="pricing-tier-header">
                <h3 className="tier-name">Starter</h3>
                <p className="tier-desc">For independent creators &amp; boutiques</p>
              </div>

              <div className="pricing-cost-row">
                <span className="cost-currency">₹</span>
                <span className="cost-amount">499</span>
                <span className="cost-cycle">/ 30 days</span>
              </div>

              <ul className="tier-features-list">
                <li><span className="check-bullet">✓</span> 1 Instagram account</li>
                <li><span className="check-bullet">✓</span> 500 AI auto-replies</li>
                <li><span className="check-bullet">✓</span> 125 AI drafts</li>
                <li><span className="check-bullet">✓</span> Unlimited AI classifications</li>
                <li><span className="check-bullet">✓</span> Unused replies roll over</li>
                <li className="tier-autodm"><span className="check-bullet">✓</span> Auto DM: {autodmPlanRow('STARTER')} <span {...autodmSoon}>Coming soon</span></li>
              </ul>

              <Link href="/register" className="btn-tier btn-tier-secondary">
                <span className="btn-text-roll">
                  <span className="btn-text-track">
                    <span className="btn-text-line">Get Started</span>
                    <span className="btn-text-line" aria-hidden="true">Get Started</span>
                  </span>
                </span>
              </Link>
            </div>

            {/* PRO (Recommended) */}
            <div className="pricing-card pricing-card-pro">
              <div className="recommended-badge">Recommended</div>

              <div className="pricing-tier-header">
                <h3 className="tier-name">Pro</h3>
                <p className="tier-desc">For high-volume creators, shops &amp; agencies</p>
              </div>

              <div className="pricing-cost-row">
                <span className="cost-currency">₹</span>
                <span className="cost-amount">1,299</span>
                <span className="cost-cycle">/ 30 days</span>
              </div>

              <ul className="tier-features-list">
                <li><span className="check-bullet">✓</span> <strong>2 Instagram accounts</strong></li>
                <li><span className="check-bullet">✓</span> <strong>2,000 AI auto-replies</strong></li>
                <li><span className="check-bullet">✓</span> <strong>500 AI drafts</strong></li>
                <li><span className="check-bullet">✓</span> <strong>Unlimited AI classifications</strong></li>
                <li><span className="check-bullet">✓</span> Unused replies roll over</li>
                <li className="tier-autodm"><span className="check-bullet">✓</span> <strong>Auto DM: {autodmPlanRow('PRO')}</strong> <span {...autodmSoon}>Coming soon</span></li>
              </ul>

              <Link href="/register" className="btn-tier btn-tier-primary">
                <span className="btn-text-roll">
                  <span className="btn-text-track">
                    <span className="btn-text-line">Get Started with Pro</span>
                    <span className="btn-text-line" aria-hidden="true">Get Started with Pro</span>
                  </span>
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            </div>

            {/* ENTERPRISE */}
            <div className="pricing-card">
              <div className="pricing-tier-header">
                <h3 className="tier-name">Enterprise</h3>
                <p className="tier-desc">For brand conglomerates &amp; large talent agencies</p>
              </div>

              <div className="pricing-cost-row">
                <span className="cost-from">From</span>
                <span className="cost-currency">₹</span>
                <span className="cost-amount">4,999</span>
              </div>

              <ul className="tier-features-list">
                <li><span className="check-bullet">✓</span> Custom Instagram accounts</li>
                <li><span className="check-bullet">✓</span> Custom AI auto-replies</li>
                <li><span className="check-bullet">✓</span> Unlimited AI drafts</li>
                <li><span className="check-bullet">✓</span> Unlimited AI classifications</li>
                <li><span className="check-bullet">✓</span> Unused replies roll over</li>
                <li><span className="check-bullet">✓</span> Dedicated Account Manager</li>
                <li><span className="check-bullet">✓</span> Custom Webhook SLAs</li>
                <li className="tier-autodm"><span className="check-bullet">✓</span> Auto DM: custom limits <span {...autodmSoon}>Coming soon</span></li>
              </ul>

              <Link href="/register" className="btn-tier btn-tier-secondary">
                <span className="btn-text-roll">
                  <span className="btn-text-track">
                    <span className="btn-text-line">Contact Enterprise</span>
                    <span className="btn-text-line" aria-hidden="true">Contact Enterprise</span>
                  </span>
                </span>
              </Link>
            </div>
          </div>

          <p className="pricing-fair-use">
            *Fair use applies. See <Link href="/terms#fair-use">Terms §8</Link>.
          </p>

          {/* Add-ons — what the billing page sells on top of a plan. Prices MUST
              match the addon_pack_prices / extra_ig_account_prices seed
              (backend/tests/landing-pricing-seed.test.js pins this). */}
          <div className="pricing-addons-box" id="add-ons">
            <h3 className="pricing-addons-title">Add-ons</h3>
            <p className="pricing-addons-text">
              One-time top-ups for the current 30-day plan, priced by plan. Auto-replies and AI drafts are
              separate credits: an auto-reply uses an auto-reply credit, and each AI draft you ask for in the
              inbox uses one draft credit.
            </p>
            <div className="pricing-addons-scroll">
              <table className="pricing-addons-table">
                <thead>
                  <tr>
                    <th scope="col">Add-on</th>
                    <th scope="col">On Starter</th>
                    <th scope="col">On Pro</th>
                  </tr>
                </thead>
                <tbody>
                  <tr data-addon="reply_credits_500">
                    <th scope="row">+500 AI auto-replies</th>
                    <td>₹299</td>
                    <td>₹149</td>
                  </tr>
                  <tr data-addon="draft_credits_125">
                    <th scope="row">+125 AI drafts</th>
                    <td>₹74.75</td>
                    <td>₹37.25</td>
                  </tr>
                  <tr data-addon="draft_credits_500">
                    <th scope="row">+500 AI drafts</th>
                    <td>₹299</td>
                    <td>₹149</td>
                  </tr>
                  <tr data-addon="extra_ig_account">
                    <th scope="row">+1 Instagram account</th>
                    <td>₹299</td>
                    <td>₹199</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Pricing Guarantee Footnote */}
          <div className="pricing-guarantee-box">
            <div className="guarantee-message">
              <h4 className="guarantee-title">No auto-debit. No mandate.</h4>
              <p className="guarantee-text">Pay only when you want to continue. Nothing renews on its own, and nothing is ever charged without you choosing it.</p>
            </div>

            <div className="guarantee-trust-badges">
              <div className="trust-badge-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                <span>Refund policy guaranteed</span>
              </div>
              <div className="trust-badge-item">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                <span>Meta Business Verified</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 9 — FOOTER */}
      <footer className="site-footer" ref={footerRef}>
        <canvas ref={canvasRef} id="footer-grid-canvas" className="footer-grid-canvas" aria-hidden="true" />
        <div className="footer-top-container">
          {/* Brand column */}
          <div className="footer-brand-col">
            <Link href="/" className="brand-logo footer-logo">
              <img src="/assets/siffty-logo-sm.webp" alt="Siffty Logo" className="brand-logo-img" width="40" height="40" />
              <span className="logo-text">Siffty</span>
            </Link>
            <p className="footer-brand-desc">
              Siffty reads, understands and organizes your Instagram DMs so you can spend less time sorting and more time on the conversations that matter.
            </p>
            <div className="footer-meta-partner">
              <img src="/assets/meta-certified-siffty.png" alt="Certified by Meta as a Verified Tech Provider" className="footer-meta-badge" />
            </div>
          </div>

          {/* Links columns */}
          <div className="footer-links-grid">
            {/* Col 1: Product */}
            <div className="footer-links-col">
              <h4 className="footer-col-title">Product</h4>
              <ul className="footer-links-list">
                <li><a href="#hero">Overview</a></li>
                <li><a href="#capabilities">Capabilities</a></li>
                <li><a href="#features">Features</a></li>
                <li><a href="#pricing">Pricing</a></li>
              </ul>
            </div>

            {/* Col 2: Resources */}
            <div className="footer-links-col">
              <h4 className="footer-col-title">Resources</h4>
              <ul className="footer-links-list">
                <li><Link href="/how-to-use">How to use</Link></li>
                <li><Link href="/founder-developer">Founder &amp; Developer</Link></li>
                <li><Link href="/support">Support</Link></li>
                <li><Link href="/contact">Contact</Link></li>
              </ul>
            </div>

            {/* Col 3: Legal */}
            <div className="footer-links-col">
              <h4 className="footer-col-title">Legal</h4>
              <ul className="footer-links-list">
                <li><Link href="/privacy">Privacy policy</Link></li>
                <li><Link href="/terms">Terms of service</Link></li>
                <li><Link href="/data-deletion">Delete your data</Link></li>
                <li><Link href="/refund-policy">Refund policy</Link></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer Bottom Row */}
        <div className="footer-bottom-container">
          <div className="footer-bottom-content">
            <p className="copyright-text">&copy; {new Date().getFullYear()} Siffty. All rights reserved.</p>
            <p className="footer-tech-note">Built with the official Instagram Graph API.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingPageContent />
    </Suspense>
  );
}
