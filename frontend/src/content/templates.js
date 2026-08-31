/**
 * Starter business profiles.
 *
 * These are seeded into real customer profiles and quoted back to real
 * customers word for word, so they are held to the same standard as any other
 * copy in the product.
 *
 * Every template has the same fields in the same order, and each field has the
 * same shape in all thirteen:
 *
 *   description       one sentence: what you do, and who for
 *   productsServices  exactly four lines, "Name — one line of detail"
 *   pricingInfo       an example-rates warning, then three priced lines
 *   locationDelivery  one sentence: where you work and how you hand over
 *   policies          two sentences: turnaround, then revisions or returns
 *   paymentMethods    a comma-separated list
 *   faqData           exactly three question-and-answer pairs
 *   aiInstructions    two sentences: what to ask for, then what never to offer
 *   tone              one value from TONE_LABELS
 *
 * Every amount is written in the one currency format used across the product
 * (see content/format.js) and is flagged as an example to replace.
 */

const PRICING_NOTICE = 'Example rates — replace these with your own before going live.';

/** `icon` is a name from components/Icon.js — never an emoji. */
export const BUSINESS_CATEGORIES = [
  { id: 'video_editor', label: 'Video editor', summary: 'Reels, shorts, and long-form edits', icon: 'sparkle' },
  { id: 'photo_editor', label: 'Photo editor', summary: 'Retouching and product photography', icon: 'eye' },
  { id: 'graphic_designer', label: 'Graphic designer', summary: 'Logos, branding, and social assets', icon: 'target' },
  { id: 'product_seller', label: 'Product seller', summary: 'Physical goods and retail', icon: 'package' },
  { id: 'used_devices', label: 'Used phones and laptops', summary: 'Refurbished devices with warranty', icon: 'smartphone' },
  { id: 'clothing', label: 'Clothing & fashion', summary: 'Apparel, sizing, and shipping', icon: 'tag' },
  { id: 'handmade_crafts', label: 'Handmade & crafts', summary: 'Handmade goods and custom orders', icon: 'palette' },
  { id: 'jewelry_accessories', label: 'Jewelry & accessories', summary: 'Custom pieces and everyday accessories', icon: 'gem' },
  { id: 'freelancer', label: 'Freelancer', summary: 'Client projects and hourly work', icon: 'briefcase' },
  { id: 'agency', label: 'Agency', summary: 'Marketing, media, and campaigns', icon: 'users' },
  { id: 'coach_consultant', label: 'Coach or consultant', summary: 'Calls, programmes, and bookings', icon: 'lifeBuoy' },
  { id: 'creator', label: 'Content creator', summary: 'Sponsorships and brand deals', icon: 'flame' },
  { id: 'photographer', label: 'Photographer', summary: 'Portraits, events, and product shoots', icon: 'camera' },
  { id: 'local_business', label: 'Local business', summary: 'Storefront and appointments', icon: 'globe' },
  { id: 'real_estate', label: 'Real estate', summary: 'Listings, viewings, and closings', icon: 'home' },
  { id: 'beauty_wellness', label: 'Beauty & wellness', summary: 'Treatments, appointments, and packages', icon: 'flower' },
  { id: 'fitness_training', label: 'Fitness & training', summary: 'Personal training and group sessions', icon: 'dumbbell' },
  { id: 'event_planner', label: 'Event planner', summary: 'Weddings, parties, and corporate events', icon: 'partyPopper' },
  { id: 'ecommerce', label: 'Online store', summary: 'Catalogue, orders, and delivery', icon: 'truck' },
  { id: 'other', label: 'Something else', summary: 'Any other business or service', icon: 'messageCircle' },
];

export const DEFAULT_KNOWLEDGE_TEMPLATES = {
  video_editor: {
    description: 'Video editor producing short-form reels and long-form edits for creators and brands.',
    productsServices: [
      'Short-form reel — edit, captions, sound design, delivered ready to post',
      'Monthly reel pack — ten reels a month at a reduced rate',
      'Long-form video edit — full cut, colour, and audio for YouTube',
      'Thumbnail design — one custom thumbnail per video',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Short-form reel: INR 1,000 each',
      'Monthly reel pack (ten reels): INR 7,500',
      'Long-form video edit: from INR 3,500',
    ].join('\n'),
    locationDelivery: 'Work is remote, delivered as a download link you can post from anywhere.',
    policies: 'Standard turnaround is 48 hours from receiving the footage. Two rounds of revisions are included on every edit.',
    paymentMethods: 'UPI, bank transfer, PayPal',
    faqData: [
      'Q: How do I send you the footage?\nA: Share a Google Drive, Dropbox, or WeTransfer link with view access.',
      'Q: Are captions and music included?\nA: Yes, captions, sound effects, and licensed music are included in every edit.',
      'Q: How fast is delivery?\nA: 48 hours for short-form, three to four working days for long-form.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the footage link and the deadline before confirming a booking. Never offer a rate below the monthly pack price.',
    tone: 'friendly',
  },

  photo_editor: {
    description: 'Photo editor retouching portrait, product, and event images for brands and photographers.',
    productsServices: [
      'Portrait retouch — skin, colour, and light on a single image',
      'Product photo batch — background removal and lighting for online listings',
      'Event photo batch — colour correction across a full shoot',
      'Composite edit — multiple images combined into one social asset',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Portrait retouch: INR 500 per image',
      'Product photo batch (ten images minimum): INR 150 per image',
      'Event photo batch: from INR 5,000',
    ].join('\n'),
    locationDelivery: 'Work is remote, delivered as full-resolution files through a download link.',
    policies: 'Standard turnaround is 48 hours for up to twenty images. Two rounds of revisions are included on every image.',
    paymentMethods: 'UPI, bank transfer, PayPal, card',
    faqData: [
      'Q: What file format should I send?\nA: Send RAW files or highest-quality JPEGs through Google Drive or WeTransfer.',
      'Q: Do you take large batches?\nA: Yes, batches over twenty-five images are quoted at a reduced per-image rate.',
      'Q: How fast is delivery?\nA: 48 hours for up to twenty images, longer for full event shoots.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the image count and a style reference before quoting. Never quote a batch rate below the minimum order size.',
    tone: 'warm',
  },

  graphic_designer: {
    description: 'Graphic designer building brand identities and social assets for small businesses and creators.',
    productsServices: [
      'Brand identity kit — logo, colour palette, type, and source files',
      'Social media pack — fifteen post and story templates a month',
      'Pitch deck or brochure — designed from your content',
      'Channel branding — banner, avatar, and thumbnail set',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Brand identity kit: INR 8,000',
      'Social media pack (fifteen posts): INR 6,500',
      'Pitch deck or brochure: from INR 1,500',
    ].join('\n'),
    locationDelivery: 'Work is remote, delivered as editable source files through a download link.',
    policies: 'First concepts arrive within three working days. Two rounds of revisions are included before final files.',
    paymentMethods: 'UPI, bank transfer, card',
    faqData: [
      'Q: What is in the brand identity kit?\nA: Primary logo, secondary mark, colour palette, type pairing, and all source files.',
      'Q: Do I get editable files?\nA: Yes, every source file is handed over once the design is approved.',
      'Q: How fast is delivery?\nA: Three working days for first concepts, one week for a full identity kit.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the business name, the audience, and any style references before committing to a timeline. Never promise a delivery date before the brief is agreed.',
    tone: 'professional',
  },

  product_seller: {
    description: 'Retailer selling lifestyle products and accessories direct to customers through Instagram.',
    productsServices: [
      'Everyday essentials — the core range, restocked weekly',
      'Gift sets — curated bundles at a combined price',
      'Tech accessories — cases, cables, and chargers',
      'Seasonal range — limited stock, changes each season',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Everyday essentials: INR 500 to INR 1,500',
      'Gift sets: from INR 1,200',
      'Free delivery on prepaid orders over INR 999',
    ].join('\n'),
    locationDelivery: 'Orders ship nationwide by courier, with a tracking link sent on dispatch.',
    policies: 'Orders are dispatched within 24 hours and arrive in three to five working days. Damaged items can be replaced within seven days with an unboxing video.',
    paymentMethods: 'UPI, card, net banking, cash on delivery',
    faqData: [
      'Q: How do I track my order?\nA: A tracking link is sent by text as soon as your parcel is dispatched.',
      'Q: Is cash on delivery available?\nA: Yes, in most areas, with a small handling charge added at checkout.',
      'Q: How fast is delivery?\nA: Three to five working days after dispatch.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the delivery postcode before confirming an order can be shipped. Never confirm stock or a delivery date that is not listed above.',
    tone: 'friendly',
  },

  used_devices: {
    description: 'Seller of tested pre-owned laptops, phones, and tablets with a written warranty.',
    productsServices: [
      'Business laptops — tested, cleaned, and ready to use',
      'Apple laptops — battery health confirmed before dispatch',
      'Phones — fully functional, original accessories included',
      'Upgrades — memory and storage fitted before shipping',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Business laptops: INR 16,000 to INR 55,000',
      'Apple laptops: from INR 35,000',
      'Phones: from INR 22,000',
    ].join('\n'),
    locationDelivery: 'Devices ship nationwide insured and protected, or can be collected in person.',
    policies: 'Devices are dispatched within 48 hours of payment clearing. Every device carries a one-month replacement warranty and a seven-day return window.',
    paymentMethods: 'UPI, bank transfer, card, cash on collection',
    faqData: [
      'Q: What condition are the devices in?\nA: Fully working, lightly used cosmetically, with the original charger included.',
      'Q: Is battery health checked?\nA: Yes, every laptop and phone is listed with its measured battery health.',
      'Q: How fast is delivery?\nA: Dispatched within 48 hours, delivered in three to five working days.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the budget and what the device will be used for before recommending a model. Never confirm the condition or battery health of a specific unit without checking.',
    tone: 'professional',
  },

  clothing: {
    description: 'Clothing label selling everyday streetwear and seasonal pieces direct to customers.',
    productsServices: [
      'Graphic tees — oversized fit, printed in-house',
      'Hoodies and sweatshirts — heavyweight cotton',
      'Co-ord sets — matching top and bottom',
      'Seasonal drops — limited runs, not restocked',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Graphic tees: INR 700 to INR 1,200',
      'Hoodies and sweatshirts: INR 1,800 to INR 2,500',
      'Co-ord sets: from INR 2,200',
    ].join('\n'),
    locationDelivery: 'Orders ship nationwide by courier, with a tracking link sent on dispatch.',
    policies: 'Orders are dispatched within 48 hours and arrive in three to five working days. Sizes can be exchanged once within seven days if the tags are intact.',
    paymentMethods: 'UPI, card, net banking, cash on delivery',
    faqData: [
      'Q: How do I choose my size?\nA: The size chart is in our highlights. Oversized fits run true to size.',
      'Q: Can I exchange for a different size?\nA: Yes, one free size exchange within seven days of delivery.',
      'Q: How fast is delivery?\nA: Three to five working days after dispatch.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the size and the delivery postcode before confirming an order. Never confirm stock in a size that is not listed as available.',
    tone: 'friendly',
  },

  freelancer: {
    description: 'Independent developer and consultant building websites and internal tools for small businesses.',
    productsServices: [
      'Landing page — single page, built and deployed',
      'Full website — multi-page site with a content editor',
      'Integrations — connecting the tools you already use',
      'Maintenance — monthly updates, fixes, and monitoring',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Landing page: from INR 15,000',
      'Full website: from INR 40,000',
      'Hourly consultation: INR 2,500 per hour',
    ].join('\n'),
    locationDelivery: 'Work is remote, handed over as a live deployment and a code repository you own.',
    policies: 'Projects start once a 50% deposit clears, with a staged review at each milestone. Thirty days of fixes are included after launch.',
    paymentMethods: 'Bank transfer, UPI, card, PayPal',
    faqData: [
      'Q: How long does a website take?\nA: Five to seven days for a landing page, two to four weeks for a full site.',
      'Q: Do you support the site after launch?\nA: Yes, thirty days of fixes are included, and monthly maintenance is available after that.',
      'Q: How do we start?\nA: Send your requirements and target launch date, and you get a fixed quote back.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the requirements, the launch date, and the budget range before offering a call. Never quote a fixed price before the scope is written down.',
    tone: 'professional',
  },

  agency: {
    description: 'Marketing agency running paid media and social campaigns for growing brands.',
    productsServices: [
      'Paid media — campaign setup and daily management',
      'Social management — content produced and published for you',
      'Conversion work — landing pages and funnel improvements',
      'Creator campaigns — sourcing, briefing, and reporting',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Social management: from INR 35,000 per month',
      'Paid media management: from INR 50,000 per month, plus ad spend',
      'One-off conversion audit: INR 20,000',
    ].join('\n'),
    locationDelivery: 'Work is remote, run through a shared channel with a weekly call and a live reporting dashboard.',
    policies: 'Campaigns launch within seven working days of the kickoff call. Three months is the minimum engagement, reviewed at each month end.',
    paymentMethods: 'Bank transfer, card, invoiced with tax',
    faqData: [
      'Q: How does onboarding work?\nA: A sixty-minute kickoff call, then campaigns go live within seven working days.',
      'Q: Do you guarantee a return on ad spend?\nA: No. Targets are agreed up front and campaigns are optimised against real conversion data.',
      'Q: What is the minimum commitment?\nA: Three months, so there is enough data to optimise against.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the monthly budget, the current revenue stage, and the website before offering a call. Never promise a specific return or a guaranteed result.',
    tone: 'professional',
  },

  coach_consultant: {
    description: 'Coach running one-to-one sessions and group programmes for founders and professionals.',
    productsServices: [
      'Strategy call — one sixty-minute session with written notes',
      'Mentorship programme — eight weeks of weekly one-to-one calls',
      'Business review — a full audit with a written action plan',
      'Resource library — templates and worksheets for clients',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Strategy call: INR 5,000',
      'Eight-week mentorship programme: INR 30,000',
      'Business review: INR 12,000',
    ].join('\n'),
    locationDelivery: 'Sessions run remotely over video, with a recording sent afterwards.',
    policies: 'Sessions are booked through a scheduling link once payment clears. Rescheduling is free with 24 hours notice.',
    paymentMethods: 'UPI, card, PayPal, instalments available',
    faqData: [
      'Q: How are sessions run?\nA: Over video call, with a recording and written notes sent afterwards.',
      'Q: Who is the programme for?\nA: Founders, creators, and professionals who want structure and accountability.',
      'Q: Can I pay in instalments?\nA: Yes, the programme can be split across the eight weeks.',
    ].join('\n\n'),
    aiInstructions: 'Ask what the single biggest challenge is right now before sharing the booking link. Never promise a specific business outcome or result.',
    tone: 'warm',
  },

  creator: {
    description: 'Content creator producing sponsored video and photo content for brands.',
    productsServices: [
      'Sponsored reel — one dedicated video on the main feed',
      'Story set — three connected stories with a link',
      'Long-form integration — a segment inside a longer video',
      'Content licence — footage supplied for the brand to run as ads',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Sponsored reel: from INR 25,000',
      'Story set (three stories): INR 8,000',
      'Reel and story bundle: INR 30,000',
    ].join('\n'),
    locationDelivery: 'Content is published to the agreed channels, with raw files supplied if licensing is included.',
    policies: 'Drafts are shared for review within three working days of the brief. Half is due on signing, the balance on delivery.',
    paymentMethods: 'Bank transfer, card, PayPal, invoiced with tax',
    faqData: [
      'Q: Can we review the content before it goes live?\nA: Yes, one round of draft review is included on every sponsored piece.',
      'Q: What are the audience demographics?\nA: Ask for the current media kit and it will be sent over.',
      'Q: How long can we run it as an ad?\nA: Thirty days of paid usage rights are included, extendable for a fee.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the campaign budget, the deliverables, and the timeline before discussing rates. Never agree to unpaid work or product-only gifting.',
    tone: 'friendly',
  },

  local_business: {
    description: 'Local business offering in-person appointments and services from a single location.',
    productsServices: [
      'Consultation — a first appointment to discuss what you need',
      'Standard service — the core treatment or service, by appointment',
      'Service package — a course of sessions at a combined price',
      'Gift card — credit that can be used against any service',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Consultation: free for first-time visitors',
      'Standard service: INR 500 to INR 2,500',
      'Service package: from INR 4,500',
    ].join('\n'),
    locationDelivery: 'Everything happens in person at our address, with directions in the profile link.',
    policies: 'We are open Tuesday to Sunday, 10:00 to 20:00. Appointments can be moved free of charge with 24 hours notice.',
    paymentMethods: 'UPI, card, cash',
    faqData: [
      'Q: Do I need an appointment?\nA: Walk-ins are welcome when there is space, but booking ahead avoids a wait.',
      'Q: Where are you?\nA: The address and directions are in the link in our profile. Parking is available.',
      'Q: What are your hours?\nA: Tuesday to Sunday, 10:00 to 20:00. Closed Mondays.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the preferred day and time before offering to book someone in. Never confirm an appointment slot without checking availability.',
    tone: 'friendly',
  },

  ecommerce: {
    description: 'Online store selling a curated product range with delivery direct to the customer.',
    productsServices: [
      'Main catalogue — the full range, browsable online',
      'New arrivals — the latest additions, updated weekly',
      'Bundles — sets sold together at a combined price',
      'Seasonal sale — reduced items while stock lasts',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Main catalogue: INR 600 to INR 5,000',
      'Bundles: from INR 1,500',
      'Free delivery on orders over INR 999',
    ].join('\n'),
    locationDelivery: 'Orders ship nationwide by courier, with a tracking link sent on dispatch.',
    policies: 'Orders are dispatched within 24 hours and arrive in two to four working days. Unused items can be returned within fourteen days.',
    paymentMethods: 'UPI, card, net banking, pay later, cash on delivery',
    faqData: [
      'Q: How do I place an order?\nA: Use the link in our profile, or send a screenshot here and a checkout link comes back.',
      'Q: What is the return policy?\nA: Fourteen days on any unused item, refunded once the parcel is collected.',
      'Q: How fast is delivery?\nA: Two to four working days after dispatch.',
    ].join('\n\n'),
    aiInstructions: 'Ask for the product name and the delivery postcode before confirming an order. Never confirm stock or a delivery date that is not listed above.',
    tone: 'friendly',
  },

  other: {
    description: 'Independent business providing services and products tailored to each client.',
    productsServices: [
      'Core service — the main thing you are hired for',
      'Custom project — scoped and quoted per client',
      'Consultation — a first conversation about what you need',
      'Ongoing support — continued help after the work is delivered',
    ].join('\n'),
    pricingInfo: [
      PRICING_NOTICE,
      'Consultation: free',
      'Core service: from INR 5,000',
      'Custom project: quoted after the brief',
    ].join('\n'),
    locationDelivery: 'Work is delivered remotely or in person, depending on what the client needs.',
    policies: 'Timelines are agreed in writing before work starts. Two rounds of revisions are included on every project.',
    paymentMethods: 'UPI, bank transfer, card',
    faqData: [
      'Q: How do we start?\nA: Send your requirements here and a quote comes back within a day.',
      'Q: How is the work priced?\nA: Fixed price per project, agreed before anything starts.',
      'Q: How fast is delivery?\nA: Agreed with you up front, based on the size of the project.',
    ].join('\n\n'),
    aiInstructions: 'Ask what the client needs and by when before quoting anything. Never quote a price before the requirements are written down.',
    tone: 'friendly',
  },
};

/** The fields every template must define, in render order. */
export const TEMPLATE_FIELDS = [
  'description',
  'productsServices',
  'pricingInfo',
  'locationDelivery',
  'policies',
  'paymentMethods',
  'faqData',
  'aiInstructions',
  'tone',
];

export function getCategoryMetadata(catId) {
  const found = BUSINESS_CATEGORIES.find((c) => c.id === catId);
  if (found) return found;
  return {
    id: catId || 'other',
    label: String(catId || 'Other')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    summary: 'Any other business or service',
    icon: 'messageCircle',
  };
}

export function parseBusinessTypes(businessTypes, primaryCategory = 'other') {
  if (Array.isArray(businessTypes) && businessTypes.length > 0) return businessTypes;
  if (typeof businessTypes === 'string' && businessTypes.trim()) {
    try {
      const parsed = JSON.parse(businessTypes);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
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
    if (t.productsServices) productsList.push(`${meta.label}\n${t.productsServices}`);
    // The example-rates notice is printed once for the combined profile, not
    // repeated per business type.
    if (t.pricingInfo) {
      const withoutNotice = t.pricingInfo.split('\n').filter((line) => line !== PRICING_NOTICE);
      pricingList.push(`${meta.label}\n${withoutNotice.join('\n')}`);
    }
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
    pricingInfo: [PRICING_NOTICE, '', ...pricingList].join('\n'),
    locationDelivery: deliveryList.join(' '),
    policies: policiesList.join(' '),
    paymentMethods: Array.from(paymentMethodsSet).join(', ') || 'UPI, bank transfer, card',
    faqData: faqList.join('\n\n'),
    aiInstructions: instructionsList.join(' '),
    tone: 'friendly',
  };
}
