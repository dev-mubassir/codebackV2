/**
 * Centralized Business Categories & Knowledge Templates
 * Used across Onboarding, Settings, and Profile management.
 */

export const BUSINESS_CATEGORIES = [
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
    paymentMethods: 'UPI, Cash, Credit/Debit Cards',
    faqData: 'Q: Do I need an appointment?\nA: Walk-ins are welcome based on availability, but advance appointments are recommended.\n\nQ: Where are you located?\nA: Main commercial district (directions in bio). Parking available.',
    aiInstructions: 'Provide business hours and location clearly. Guide customers to book an appointment slot.',
    tone: 'friendly',
  },
  ecommerce: {
    description: 'Digital e-commerce brand curating high-quality products with online catalogue browsing and express doorstep delivery.',
    productsServices: '• Featured Store Catalogue & New Arrivals\n• Exclusive Bundle Collections & Gift Sets\n• Seasonal Sales & Subscriber Specials',
    pricingInfo: 'Products from ₹599 to ₹4,999. Free shipping across the country on all orders above ₹999.',
    locationDelivery: 'Doorstep courier delivery in 2-4 business days with end-to-end SMS & WhatsApp tracking.',
    policies: 'Easy 14-day return and exchange policy. Instant refund upon return parcel pickup.',
    paymentMethods: 'All major Credit/Debit Cards, UPI, Net Banking, PayLater, Cash on Delivery',
    faqData: 'Q: How do I place an order?\nA: Tap the link in our bio or send us the product screenshot right here in DMs to get a direct payment checkout link.\n\nQ: What is the return policy?\nA: 14-day hassle-free returns on all unused items.',
    aiInstructions: 'Share website link or direct checkout links for requested products. Confirm shipping times warmly.',
    tone: 'friendly',
  },
  other: {
    description: 'Custom business providing personalized services, client solutions, and tailored products.',
    productsServices: '• Core Business Services & Tailored Client Solutions\n• Custom Project Consultations & Quotes\n• Priority Client Support',
    pricingInfo: 'Custom pricing based on scope of work. Contact us with your project details for an instant tailored quote.',
    locationDelivery: 'Digital or local delivery tailored to client requirements.',
    policies: 'Clear milestone agreements with structured deliverables and client satisfaction guarantee.',
    paymentMethods: 'UPI, Bank Transfer, Online Payment Gateway',
    faqData: 'Q: How do I get started?\nA: Send us a DM with your specific requirements and we will reply within a few hours.',
    aiInstructions: 'Be helpful, responsive, and collect client requirements before scheduling a consultation.',
    tone: 'friendly',
  },
};

export function getCategoryMetadata(catId) {
  return BUSINESS_CATEGORIES.find((c) => c.id === catId) || {
    id: catId || 'other',
    label: (catId || 'Other').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: '⚡',
    defaultPrompt: 'Custom business or service',
  };
}

export function parseBusinessTypes(businessTypes, primaryCategory = 'other') {
  if (Array.isArray(businessTypes) && businessTypes.length > 0) {
    return businessTypes;
  }
  if (typeof businessTypes === 'string' && businessTypes.trim()) {
    try {
      const parsed = JSON.parse(businessTypes);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // not json, return comma separated or single item
      const split = businessTypes.split(',').map((s) => s.trim()).filter(Boolean);
      if (split.length > 0) return split;
    }
  }
  return primaryCategory ? [primaryCategory] : ['other'];
}

export function combineKnowledgeTemplates(categoryIds = []) {
  const ids = Array.isArray(categoryIds) && categoryIds.length > 0 ? categoryIds : ['other'];
  if (ids.length === 1) {
    return DEFAULT_KNOWLEDGE_TEMPLATES[ids[0]] || DEFAULT_KNOWLEDGE_TEMPLATES.other;
  }

  const descriptions = [];
  const productsList = [];
  const pricingList = [];
  const deliveryList = [];
  const policiesList = [];
  const paymentMethodsSet = new Set();
  const faqList = [];
  const instructionsList = [];

  ids.forEach((id) => {
    const t = DEFAULT_KNOWLEDGE_TEMPLATES[id] || DEFAULT_KNOWLEDGE_TEMPLATES.other;
    const meta = getCategoryMetadata(id);

    if (t.description) descriptions.push(t.description);
    if (t.productsServices) productsList.push(`[${meta.label}]\n${t.productsServices}`);
    if (t.pricingInfo) pricingList.push(`[${meta.label}]: ${t.pricingInfo}`);
    if (t.locationDelivery && !deliveryList.includes(t.locationDelivery)) deliveryList.push(t.locationDelivery);
    if (t.policies && !policiesList.includes(t.policies)) policiesList.push(t.policies);
    if (t.paymentMethods) {
      t.paymentMethods.split(',').forEach((p) => paymentMethodsSet.add(p.trim()));
    }
    if (t.faqData) faqList.push(t.faqData);
    if (t.aiInstructions) instructionsList.push(t.aiInstructions);
  });

  return {
    description: descriptions.join(' '),
    productsServices: productsList.join('\n\n'),
    pricingInfo: pricingList.join('\n'),
    locationDelivery: deliveryList.join(' | '),
    policies: policiesList.join(' | '),
    paymentMethods: Array.from(paymentMethodsSet).join(', ') || 'UPI, Bank Transfer, Card',
    faqData: faqList.join('\n\n'),
    aiInstructions: instructionsList.join(' '),
    tone: 'friendly',
  };
}
