'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getOnboarding, saveOnboarding } from '@/lib/api';
import styles from './onboarding.module.css';

const BUSINESS_CATEGORIES = [
  { id: 'video_editor', label: 'Video Editor', icon: '🎬', defaultPrompt: 'Reels, YouTube edits, turnaround 2-3 days' },
  { id: 'photo_editor', label: 'Photo Editor / Retoucher', icon: '📸', defaultPrompt: 'Portrait editing, product photos' },
  { id: 'graphic_designer', label: 'Graphic Designer', icon: '🎨', defaultPrompt: 'Logos, branding, social media posts' },
  { id: 'product_seller', label: 'Product Seller', icon: '📦', defaultPrompt: 'Physical goods, retail, merchandise' },
  { id: 'used_devices', label: 'Used Phones & Laptops', icon: '💻', defaultPrompt: 'Laptops, smartphones, warranties' },
  { id: 'clothing', label: 'Clothing & Fashion', icon: '👗', defaultPrompt: 'Apparel, sizing, shipping across regions' },
  { id: 'freelancer', label: 'Freelancer / Solopreneur', icon: '💼', defaultPrompt: 'Custom client services & hourly quotes' },
  { id: 'agency', label: 'Agency / Studio', icon: '🏢', defaultPrompt: 'Marketing, web development, campaigns' },
  { id: 'coach_consultant', label: 'Coach / Consultant', icon: '🧠', defaultPrompt: '1-on-1 calls, programs, bookings' },
  { id: 'creator', label: 'Content Creator', icon: '⭐', defaultPrompt: 'Sponsorships, brand deals, media kit' },
  { id: 'local_business', label: 'Local Business', icon: '📍', defaultPrompt: 'Storefront, appointments, local service' },
  { id: 'ecommerce', label: 'E-commerce Store', icon: '🛒', defaultPrompt: 'Online catalogue, order tracking, shipping' },
  { id: 'other', label: 'Other Business', icon: '⚡', defaultPrompt: 'Custom business or service' },
];

export const DEFAULT_KNOWLEDGE_TEMPLATES = {
  video_editor: {
    description: 'Professional video editor specializing in high-engagement Instagram Reels, TikToks, Shorts, and long-form YouTube videos.',
    productsServices: '• Short-Form Reels/TikToks with dynamic motion graphics & sound design (₹750 - ₹1,500/reel)\n• 10-Reels Monthly Growth Pack (₹7,500)\n• Long-form YouTube Edits (₹3,500 - ₹8,000)\n• High-CTR Thumbnail Design (₹500)',
    pricingInfo: 'Single Reel: ₹1,000 | 10-Reel Monthly Bundle: ₹7,500. YouTube edits start at ₹3,500 depending on raw footage duration.',
    locationDelivery: 'Online cloud delivery (Google Drive, Dropbox, WeTransfer). Serving creators globally.',
    policies: 'Standard delivery within 48 hours. Includes 2 complimentary rounds of revisions. Express 24h turnaround available for +30% fee.',
    paymentMethods: 'UPI (GPay / PhonePe / Paytm), Bank Transfer (NEFT/IMPS), PayPal for international clients',
    faqData: 'Q: How do I send raw footage?\nA: Please share a Google Drive, Dropbox, or WeTransfer link with edit access.\n\nQ: Do you include captions and background music?\nA: Yes! Animated subtitles, sound effects, and licensed royalty-free music are included in all packages.\n\nQ: What is your turnaround time?\nA: 48 hours for short-form reels, 3-4 business days for long-form YouTube edits.',
    aiInstructions: 'Always ask the client for their video footage link and target deadline before finalizing the booking. Never offer discounts below the 10-pack bundle rate.',
    tone: 'friendly',
  },
  photo_editor: {
    description: 'High-end photo retoucher and digital editor specializing in portrait, fashion, product, and e-commerce photo enhancement.',
    productsServices: '• High-End Skin Retouching & Color Grading\n• E-commerce Product Photo Background Removal & Lighting (Amazon/Shopify)\n• Batch Wedding & Event Photo Color Correction\n• Creative Social Media Compositing',
    pricingInfo: 'Portrait retouch: ₹350 - ₹750/photo. E-commerce batch: ₹150/image (minimum 10 images). Event batches: Custom package upon request.',
    locationDelivery: 'Digital file delivery via cloud links in Full-Resolution JPEG, TIFF, and PNG formats.',
    policies: 'Turnaround is 24-48 hours for up to 20 photos. Includes 2 free rounds of revisions per image.',
    paymentMethods: 'UPI, Bank Transfer, PayPal, Stripe',
    faqData: 'Q: What file format should I send?\nA: RAW or maximum quality JPEG files via Google Drive or WeTransfer.\n\nQ: Do you offer bulk discounts?\nA: Yes, batches over 25 photos receive an automatic 15% discount.',
    aiInstructions: 'Ask the client for the number of photos and sample style references. Be polite, prompt, and professional.',
    tone: 'warm',
  },
  graphic_designer: {
    description: 'Creative brand identity and graphic designer crafting high-impact social media creatives, vector logos, and marketing collateral.',
    productsServices: '• Custom Vector Logo & Complete Brand Identity Kit\n• Social Media Carousel Templates & Post Packs\n• Marketing Pitch Decks, Banners & Brochures\n• YouTube Banner & Branding Packages',
    pricingInfo: 'Complete Logo & Brand Kit: ₹8,000 ($100). Social Media Monthly Pack (15 posts): ₹6,500. Single Banner/Deck: Starting at ₹1,500.',
    locationDelivery: 'Digital vector delivery (AI, PSD, SVG, PDF, PNG) via cloud drive.',
    policies: 'Initial concept drafts delivered within 3 business days. Final deliverable includes full commercial copyright license.',
    paymentMethods: 'UPI, Bank Transfer, Credit Card / Stripe',
    faqData: 'Q: What is included in the Brand Identity Kit?\nA: Primary logo, secondary mark, color palette, typography pairing guide, and source vector files.\n\nQ: Do I get editable files?\nA: Yes, all vector source files (AI, PSD, SVG, PDF) are provided upon final approval.',
    aiInstructions: 'Request the client\'s business name, target audience, and any visual style references before giving a timeline commitment.',
    tone: 'professional',
  },
  product_seller: {
    description: 'Retailer and seller of premium lifestyle products, gadgets, and curated physical goods with fast pan-India courier delivery.',
    productsServices: '• Premium Lifestyle Goods & Daily Essentials\n• Curated Gift Hampers & Value Combos\n• Trending Tech Accessories',
    pricingInfo: 'Products range from ₹499 to ₹3,499. Free express shipping on all prepaid orders above ₹999.',
    locationDelivery: 'Dispatched within 24 hours. Standard delivery 3-5 business days across India with real-time tracking.',
    policies: '7-day replacement guarantee for damaged or defective items during transit. Unboxing video required for claim.',
    paymentMethods: 'UPI, Credit/Debit Cards, Net Banking, Cash on Delivery (COD available for ₹50 extra)',
    faqData: 'Q: How do I track my order?\nA: A live tracking link is sent via SMS and WhatsApp as soon as your package is dispatched.\n\nQ: Is Cash on Delivery available?\nA: Yes, COD is available across most serviceable pin codes for an additional ₹50 convenience fee.',
    aiInstructions: 'Ask customers for their delivery PIN code to confirm serviceability. Provide product prices clearly and guide them on how to place orders.',
    tone: 'friendly',
  },
  used_devices: {
    description: 'Certified seller of pre-owned laptops, MacBooks, iPads, and smartphones with full hardware testing and warranty guarantee.',
    productsServices: '• Refurbished Business Laptops (Lenovo ThinkPad, Dell Latitude, HP EliteBook)\n• Pre-owned Apple MacBooks (Air & Pro M1/M2/Intel)\n• Certified Pre-Owned iPhones & Android Flagships\n• RAM & SSD Storage Upgrades',
    pricingInfo: 'Laptops from ₹16,000 to ₹55,000. MacBooks starting from ₹35,000. iPhones starting from ₹22,000. Full specs and battery health provided before dispatch.',
    locationDelivery: 'Insured multi-layer protective shipping pan-India. Local pickup available in store.',
    policies: '1-month complete replacement warranty + 6 months hardware service support. 7-day testing return policy.',
    paymentMethods: 'UPI, Bank Transfer, Credit Card EMI, Cash on Delivery with partial advance deposit',
    faqData: 'Q: What condition are the devices in?\nA: Grade A condition (9/10 cosmetics), 100% functional, original charger included.\n\nQ: Is battery health tested?\nA: Yes, all MacBooks and iPhones have minimum 85%+ battery health or new OEM replacement.\n\nQ: How do you handle shipping?\nA: Safe multi-layer bubble packaging with courier insurance.',
    aiInstructions: 'Ask the customer what their budget and primary use case (coding, editing, college, office) are so we can recommend the best machine.',
    tone: 'professional',
  },
  clothing: {
    description: 'Trendy fashion apparel and streetwear clothing brand delivering stylish, high-quality outfits, graphic tees, and accessories.',
    productsServices: '• Oversized Graphic Tees & Vintage Washed T-Shirts\n• Premium Cotton Hoodies & Sweatshirts\n• Co-ord Sets & Casual Streetwear\n• Limited Edition Seasonal Drops',
    pricingInfo: 'Tees from ₹699 - ₹1,199. Hoodies: ₹1,799 - ₹2,499. Co-ord sets: ₹2,199. Flat 10% off on first prepaid orders with code FIRST10.',
    locationDelivery: 'Dispatched within 24-48 hours. Express delivery across India in 3-5 business days.',
    policies: 'Easy 7-day size exchange policy (tags must be intact). Free exchange on first size swap.',
    paymentMethods: 'UPI, Credit/Debit Cards, Net Banking, Cash on Delivery',
    faqData: 'Q: How do I choose my size?\nA: Please check our size chart in highlights. Our oversized fits are relaxed true-to-size.\n\nQ: Can I exchange if the size does not fit?\nA: Yes! We offer free size exchanges within 7 days of delivery.',
    aiInstructions: 'Be warm and enthusiastic. Guide customers on sizing and stock availability. Suggest matching bottoms or outerwear when they ask about a piece.',
    tone: 'friendly',
  },
  freelancer: {
    description: 'Independent full-stack developer, copywriter, and digital consultant helping businesses build high-converting websites and systems.',
    productsServices: '• Custom Web Development (React / Next.js / Shopify / WordPress)\n• High-Converting Landing Pages & Sales Funnels\n• API Integrations & Workflow Automations\n• Monthly Website Maintenance & SEO Audit',
    pricingInfo: 'Landing Pages start at ₹15,000 ($250). Full Web Apps / E-commerce from ₹40,000 ($600). Hourly consultation: ₹2,500/hr.',
    locationDelivery: 'Remote delivery worldwide via GitHub, Vercel, and cloud deployment.',
    policies: 'Projects require 50% advance deposit to schedule. Milestones defined with structured staging reviews. Includes 30 days free post-launch support.',
    paymentMethods: 'Bank Transfer (NEFT/RTGS/IMPS), UPI, Stripe, Wise, PayPal',
    faqData: 'Q: What is your typical timeline for a website?\nA: Landing pages take 5-7 days. Full multi-page apps take 2-4 weeks.\n\nQ: Do you provide post-launch support?\nA: Yes, 30 days of free bug fixes and maintenance are included after deployment.',
    aiInstructions: 'Politely ask the client for their project requirements, target launch date, and budget range before offering call booking.',
    tone: 'professional',
  },
  agency: {
    description: 'Full-service digital marketing and creative agency driving customer acquisition, paid media (Meta & Google Ads), and social growth.',
    productsServices: '• Performance Marketing & Paid Ads (Meta & Google Ads Management)\n• End-to-End Social Media Management & Content Production\n• Conversion Rate Optimization & Funnel Design\n• Influencer Marketing Campaign Execution',
    pricingInfo: 'Monthly Retainer starting at ₹35,000/month ($500/mo) for social management, and ₹50,000/month ($750/mo) + ad spend for performance marketing.',
    locationDelivery: 'Dedicated Slack channel, weekly sprint calls, and live 24/7 client reporting dashboard.',
    policies: 'Minimum 3-month engagement recommended for measurable ROI. Weekly sprint updates and real-time dashboard reporting.',
    paymentMethods: 'Corporate Bank Wire / ACH, GST Invoicing, Stripe Corporate',
    faqData: 'Q: What is your onboarding process?\nA: After contract signing, we conduct a 60-minute strategy discovery call and launch campaigns within 7 business days.\n\nQ: Do you guarantee ROAS?\nA: We establish clear KPI benchmarks and optimize continuously based on real conversion data.',
    aiInstructions: 'Qualify the lead by asking for their monthly ad budget, current revenue stage, and website URL before booking a discovery call.',
    tone: 'professional',
  },
  coach_consultant: {
    description: 'Expert coach and consultant providing actionable 1-on-1 mentorship, group coaching programs, and strategic growth guidance.',
    productsServices: '• 1-on-1 Strategy & Mentorship Call (60 Mins)\n• 8-Week Intensive Coaching Cohort\n• VIP Consultation & Business Roadmap Audit\n• Custom Digital Resource Library & Action Templates',
    pricingInfo: 'Single 60-min Strategy Call: ₹4,999 ($99). 8-Week 1-on-1 Mentorship Program: ₹29,999 ($499). Split payment plans available.',
    locationDelivery: 'Conducted live via Zoom / Google Meet with full session recordings and transcript summaries provided.',
    policies: 'Sessions booked via Calendly link after confirmation. 24-hour advance notice required for rescheduling.',
    paymentMethods: 'UPI, Credit Cards via Stripe / Razorpay, PayPal',
    faqData: 'Q: How are sessions conducted?\nA: Over Zoom or Google Meet with video recording provided afterward.\n\nQ: Who is this program for?\nA: Creators, founders, and professionals seeking structured accountability and proven frameworks.',
    aiInstructions: 'Be encouraging, warm, and structured. Ask the prospect what their single biggest challenge is right now before sharing the booking link.',
    tone: 'warm',
  },
  creator: {
    description: 'Digital creator and influencer producing high-engagement content in tech, lifestyle, fitness, and creative storytelling.',
    productsServices: '• Dedicated Instagram Reel / TikTok Integration\n• Multi-Slide Story Set with Swipe-Up / Sticker Links\n• Long-form YouTube Sponsorship\n• User-Generated Content (UGC) for Brand Ads\n• Event Appearance & Brand Ambassadorship',
    pricingInfo: 'Dedicated Reel: Starting at ₹25,000 ($350). Story Set: ₹8,000 ($120). Combo Campaign (1 Reel + 2 Stories): ₹30,000 ($450).',
    locationDelivery: 'Delivered directly to Instagram feed and stories as collaborative branded content.',
    policies: '50% advance upon contract signing, balance upon draft delivery. Draft review turnaround: 3 business days. 30-day ad usage rights included.',
    paymentMethods: 'Bank Transfer / NEFT, GST Invoice, PayPal / Wise for international brands',
    faqData: 'Q: Can we review the draft before posting?\nA: Yes, all sponsored deliverables include 1 round of draft review prior to going live.\n\nQ: What are your audience demographics?\nA: 65% 18-34 age group, high tech/lifestyle affinity, top regions: India, US, UK.',
    aiInstructions: 'Always ask the brand for their campaign budget, deliverable requirements, and target timeline. Never agree to unpaid product-only gifting.',
    tone: 'friendly',
  },
  local_business: {
    description: 'Local service provider and storefront dedicated to providing top-tier in-person experiences, treatments, and appointments.',
    productsServices: '• In-Clinic / Salon / Studio Consultations & Treatments\n• Signature Service Packages\n• Gift Cards & Membership Plans\n• Home Service Appointments (Select locations)',
    pricingInfo: 'Services range from ₹500 to ₹4,500. Free initial consultation for first-time visitors.',
    locationDelivery: 'In-store service at our main branch location.',
    policies: 'Open Tuesday through Sunday, 10:00 AM - 8:00 PM. Prior appointment booking recommended to avoid waiting.',
    paymentMethods: 'UPI, Cash, Debit/Credit Card on-site',
    faqData: 'Q: Where are you located?\nA: We are located in the main market center with dedicated customer parking available.\n\nQ: Do you accept walk-ins?\nA: Walk-ins are welcome based on slot availability, but advance booking is strongly recommended.',
    aiInstructions: 'Be welcoming and helpful. Share our operating hours, location details, and guide the customer to book an appointment slot.',
    tone: 'warm',
  },
  ecommerce: {
    description: 'Modern direct-to-consumer (D2C) e-commerce store offering trending products with fast fulfillment and order support.',
    productsServices: '• Exclusive Online Product Catalog\n• Bundle Deals & Value Packs\n• Gift Cards & Corporate Orders',
    pricingInfo: 'Prices as listed on our website. Flat ₹100 off on first order with code WELCOME10. Free shipping on orders over ₹799.',
    locationDelivery: 'Fast dispatch within 24 hours. Express courier delivery in 3-4 business days.',
    policies: 'Orders processed in 24 hours. Delivery within 3-4 business days. 7-day return/exchange window for unused items in original packaging.',
    paymentMethods: 'UPI, Cards, Net Banking, Wallets, Cash on Delivery (COD)',
    faqData: 'Q: How do I check order status?\nA: Please share your Order ID or registered mobile number to get real-time tracking.\n\nQ: What if I receive a damaged product?\nA: Send an unboxing video within 48 hours to our support for an immediate free replacement.',
    aiInstructions: 'Assist with product recommendations, discount codes, and order tracking. Provide direct website links when appropriate.',
    tone: 'friendly',
  },
};

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Basic Identity
  const [displayName, setDisplayName] = useState('');
  const [businessName, setBusinessName] = useState('');

  // Step 2: What do you do?
  const [selectedCategory, setSelectedCategory] = useState('video_editor');
  const [customCategory, setCustomCategory] = useState('');

  // Step 3: Business Information
  const [description, setDescription] = useState('');
  const [productsServices, setProductsServices] = useState('');
  const [pricingInfo, setPricingInfo] = useState('');
  const [locationDelivery, setLocationDelivery] = useState('');
  const [policies, setPolicies] = useState('');
  const [paymentMethods, setPaymentMethods] = useState('');
  const [faqData, setFaqData] = useState('');
  const [aiInstructions, setAiInstructions] = useState('');
  const [tone, setTone] = useState('friendly');

  function applyCategoryTemplate(catId, force = false) {
    const template = DEFAULT_KNOWLEDGE_TEMPLATES[catId];
    if (!template) {
      // For 'other' category, clear if forced
      if (catId === 'other' && force) {
        setDescription('');
        setProductsServices('');
        setPricingInfo('');
        setLocationDelivery('');
        setPolicies('');
        setPaymentMethods('');
        setFaqData('');
        setAiInstructions('');
        setTone('friendly');
      }
      return;
    }

    if (force || !description) {
      setDescription(template.description || '');
      setProductsServices(template.productsServices || '');
      setPricingInfo(template.pricingInfo || '');
      setLocationDelivery(template.locationDelivery || '');
      setPolicies(template.policies || '');
      setPaymentMethods(template.paymentMethods || '');
      setFaqData(template.faqData || '');
      setAiInstructions(template.aiInstructions || '');
      setTone(template.tone || 'friendly');
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const data = await getOnboarding();
        if (data.user) {
          setDisplayName(data.user.name || '');
        }
        if (data.businessProfile) {
          const bp = data.businessProfile;
          setBusinessName(bp.businessName || data.user?.name || '');
          const initialCat = bp.primaryCategory || 'video_editor';
          setSelectedCategory(initialCat);

          if (bp.description) {
            setDescription(bp.description);
            setProductsServices(bp.productsServices || '');
            setPricingInfo(bp.pricingInfo || '');
            setLocationDelivery(bp.locationDelivery || '');
            setPolicies(bp.policies || '');
            setPaymentMethods(bp.paymentMethods || '');
            setFaqData(bp.faqData || '');
            setAiInstructions(bp.aiInstructions || '');
            setTone(bp.tone || 'friendly');
          } else {
            // Apply default template for category if profile has no saved description
            applyCategoryTemplate(initialCat, true);
          }
        } else {
          applyCategoryTemplate('video_editor', true);
        }
      } catch (err) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  function handleCategorySelect(catId) {
    setSelectedCategory(catId);
    applyCategoryTemplate(catId, true);
  }

  async function handleFinish() {
    setSaving(true);
    setError('');

    try {
      await saveOnboarding({
        displayName,
        businessName: businessName || displayName,
        primaryCategory: selectedCategory === 'other' && customCategory ? customCategory : selectedCategory,
        businessTypes: JSON.stringify([selectedCategory]),
        description,
        productsServices,
        pricingInfo,
        locationDelivery,
        policies,
        paymentMethods,
        faqData,
        aiInstructions,
        tone,
      });

      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save onboarding data. Please try again.');
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.onboardingLayout}>
        <div className="spinner spinner-lg" style={{ marginTop: '100px' }} />
      </div>
    );
  }

  return (
    <div className={styles.onboardingLayout}>
      <div className={styles.wizardContainer}>
        {/* Wizard Header */}
        <div className={styles.wizardHeader}>
          <div className={styles.logoBadge}>⚡</div>
          <h1 className={styles.wizardTitle}>Setup Your Business Profile</h1>
          <p className={styles.wizardSubtitle}>
            Help Codeback understand your business so AI can accurately qualify leads, answer customer questions, and protect your brand.
          </p>

          {/* Step Progress */}
          <div className={styles.stepProgress}>
            <div className={`${styles.stepDot} ${currentStep === 1 ? styles.stepActive : currentStep > 1 ? styles.stepCompleted : ''}`}>
              <span className={styles.stepNumber}>{currentStep > 1 ? '✓' : '1'}</span>
              <span>Identity</span>
            </div>
            <div className={styles.stepDivider} />
            <div className={`${styles.stepDot} ${currentStep === 2 ? styles.stepActive : currentStep > 2 ? styles.stepCompleted : ''}`}>
              <span className={styles.stepNumber}>{currentStep > 2 ? '✓' : '2'}</span>
              <span>Category</span>
            </div>
            <div className={styles.stepDivider} />
            <div className={`${styles.stepDot} ${currentStep === 3 ? styles.stepActive : ''}`}>
              <span className={styles.stepNumber}>3</span>
              <span>Knowledge Base</span>
            </div>
          </div>
        </div>

        {error && <div className={styles.errorBanner}>{error}</div>}

        {/* Step 1: Basic Identity */}
        {currentStep === 1 && (
          <div className={styles.card}>
            <h2 className={styles.stepTitle}>Step 1: What is your name and business?</h2>
            <p className={styles.stepDesc}>
              This will be used to personalize how AI addresses you and introduces your business.
            </p>

            <div className={styles.formGrid}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Your Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Alex Rivera"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Business or Brand Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. PixelCraft Studios or Urban Kicks"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
                <span className={styles.formHint}>Leave blank if you operate under your personal name.</span>
              </div>
            </div>

            <div className={styles.wizardActions}>
              <div />
              <button
                className="btn btn-primary btn-md"
                onClick={() => setCurrentStep(2)}
                disabled={!displayName.trim()}
              >
                Next: What do you do? →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: What do you do? */}
        {currentStep === 2 && (
          <div className={styles.card}>
            <h2 className={styles.stepTitle}>Step 2: What is your primary business type?</h2>
            <p className={styles.stepDesc}>
              Select the category that best describes your Instagram operation. AI adapts its qualification logic to match your workflow.
            </p>

            <div className={styles.categoryGrid}>
              {BUSINESS_CATEGORIES.map((cat) => (
                <div
                  key={cat.id}
                  className={`${styles.categoryCard} ${selectedCategory === cat.id ? styles.categoryCardActive : ''}`}
                  onClick={() => handleCategorySelect(cat.id)}
                >
                  <span className={styles.categoryIcon}>{cat.icon}</span>
                  <span className={styles.categoryLabel}>{cat.label}</span>
                </div>
              ))}
            </div>

            {selectedCategory === 'other' && (
              <div className={styles.formRow} style={{ marginTop: '12px' }}>
                <label className={styles.formLabel}>Describe your business category</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Antique watches, 3D printing service, fitness trainer"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                />
              </div>
            )}

            <div className={styles.wizardActions}>
              <button className="btn btn-secondary btn-md" onClick={() => setCurrentStep(1)}>
                ← Back
              </button>
              <button className="btn btn-primary btn-md" onClick={() => setCurrentStep(3)}>
                Next: Business Knowledge Base →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Business Information */}
        {currentStep === 3 && (
          <div className={styles.card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2 className={styles.stepTitle}>Step 3: Train your AI Knowledge Base</h2>
                <p className={styles.stepDesc}>
                  Fill in your pricing, services, and policies. AI will ONLY answer customer questions based on facts provided here — it will never hallucinate or invent prices.
                </p>
              </div>
              {selectedCategory !== 'other' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => applyCategoryTemplate(selectedCategory, true)}
                  title="Restore default knowledge template for this category"
                  style={{ alignSelf: 'flex-start' }}
                >
                  ↺ Reset Defaults
                </button>
              )}
            </div>

            {selectedCategory !== 'other' ? (
              <div style={{ padding: '8px 12px', background: 'rgba(124, 58, 237, 0.08)', border: '1px solid rgba(124, 58, 237, 0.2)', borderRadius: 'var(--radius-md)', fontSize: '12px', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <span>✨</span>
                <span>Pre-filled with standard <strong>{BUSINESS_CATEGORIES.find(c => c.id === selectedCategory)?.label || 'Business'}</strong> knowledge base. Customize any detail below or keep as is.</span>
              </div>
            ) : (
              <div style={{ padding: '8px 12px', background: 'rgba(0, 0, 0, 0.03)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <span>⚡</span>
                <span>Custom business profile. Fill in your specific services, pricing, and rules below.</span>
              </div>
            )}

            <div className={styles.formGrid}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Business Description</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="What do you do? e.g. High-converting short-form video editing for finance and tech creators."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Products or Services Offered</label>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="List your items or services. e.g. Reel editing, color grading, sound design, YouTube packages."
                  value={productsServices}
                  onChange={(e) => setProductsServices(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Pricing, Starting Rates & Packages</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="e.g. Reels: ₹750/each. 10-pack: ₹6,500. Custom projects require footage review."
                  value={pricingInfo}
                  onChange={(e) => setPricingInfo(e.target.value)}
                />
                <span className={styles.formHint}>AI will quote these exact rates to inquiring customers.</span>
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Turnaround Time, Location & Shipping / Delivery</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="e.g. Standard delivery is 48 hours. Express 24h available for +₹300."
                  value={policies}
                  onChange={(e) => setPolicies(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Payment Methods Accepted</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. UPI, Bank Transfer, PayPal, Stripe invoice"
                  value={paymentMethods}
                  onChange={(e) => setPaymentMethods(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Frequently Asked Questions (FAQs)</label>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Q: Do you offer revisions? A: Yes, 2 rounds of free revisions included.&#10;Q: How do I send files? A: Via Google Drive or WeTransfer."
                  value={faqData}
                  onChange={(e) => setFaqData(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Custom AI Guidelines & Rules</label>
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="e.g. Always ask the customer for their raw footage link before confirming final price. Never promise same-day delivery."
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                />
              </div>

              <div className={styles.formRow}>
                <label className={styles.formLabel}>Preferred AI Reply Tone</label>
                <select className="select" value={tone} onChange={(e) => setTone(e.target.value)}>
                  <option value="friendly">Friendly & Approachable</option>
                  <option value="professional">Professional & Direct</option>
                  <option value="casual">Casual & Conversational</option>
                  <option value="concise">Concise & Minimal</option>
                  <option value="warm">Warm & Welcoming</option>
                </select>
              </div>
            </div>

            <div className={styles.wizardActions}>
              <button className="btn btn-secondary btn-md" onClick={() => setCurrentStep(2)}>
                ← Back
              </button>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleFinish}
                disabled={saving}
                id="finish-onboarding-btn"
              >
                {saving ? 'Saving Profile…' : '🚀 Finish Setup & Go to Dashboard'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
