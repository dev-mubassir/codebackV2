/**
 * Every static string a person reads in Codeback.
 *
 * House style:
 *  - Second person. "You", never "we".
 *  - Sentence case for headings, buttons, labels, and card titles.
 *  - Headings 4 words or fewer. Subtitles 12 words or fewer, one line.
 *  - Buttons 3 words or fewer, verb first.
 *  - No emoji anywhere in this file. Icons come from the SVG set.
 *  - Errors read "Couldn't <action>. <What to do>." — no codes, no blame.
 *
 * Canonical terms: business profile, connected account, conversation,
 * message, needs your reply, hot leads, brand deals, suggested reply,
 * conversation insights, reply mode, Settings, Account.
 */

export const common = {
  productName: 'Codeback',
  loading: 'Loading…',
  saving: 'Saving…',
  sending: 'Sending…',
  deleting: 'Deleting…',
  save: 'Save changes',
  saved: 'Changes saved',
  cancel: 'Cancel',
  close: 'Close',
  search: 'Search',
  filter: 'Filter',
  next: 'Next',
  previous: 'Previous',
  back: 'Back',
  retry: 'Try again',
  copy: 'Copy',
  copied: 'Copied',
  edit: 'Edit',
  delete: 'Delete',
  viewAll: 'View all',
  notSet: 'Not set',
  notConfigured: 'Not added yet',
  never: 'Never',
  unknown: 'Unknown',
  none: 'None',
};

export const nav = {
  sections: {
    overview: 'Overview',
    messaging: 'Messaging',
    configuration: 'Configuration',
  },
  dashboard: 'Dashboard',
  inbox: 'Inbox',
  notifications: 'Notifications',
  settings: 'Settings',
  account: 'Account',
  logOut: 'Log out',
  openMenu: 'Open menu',
  accountSubtitle: 'Account and profile',
};

export const dashboard = {
  greeting: {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
  },
  subtitleFallback: 'Your connected accounts and conversation activity.',
  connectInstagram: 'Connect Instagram',
  addAccount: 'Add account',

  connectionAlert: {
    title: 'Reconnect an account',
    body: 'Codeback stops receiving new messages until you reconnect.',
  },

  metrics: {
    needsReply: { label: 'Needs your reply', hint: 'Conversations flagged for you personally' },
    hotLeads: { label: 'Hot leads', hint: 'Ready to buy or book now' },
    brandDeals: { label: 'Brand deals', hint: 'Sponsorship and collaboration offers' },
    unread: { label: 'Unread', hint: 'Conversations you have not opened' },
  },

  away: {
    title: 'Since your last visit',
    reviewAction: 'Review these',
  },

  accounts: {
    title: 'Connected accounts',
    openInbox: 'Open inbox',
    reconnect: 'Reconnect',
    disconnect: 'Disconnect',
    tokenExpires: 'Access expires',
  },

  analytics: {
    title: 'Analytics',
    refresh: 'Refresh analytics',
    rangeLabel: 'Date range',
    ranges: {
      '24h': 'Last 24 hours',
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
    },
    noData: 'Not enough data yet',

    totalMessages: {
      label: 'MESSAGES RECEIVED',
      hint: 'Messages people sent you in this period',
      unit: 'messages',
    },
    hotLeads: {
      label: 'HOT LEADS',
      hint: 'Conversations with strong buying intent',
      unit: 'hot leads',
    },
    needsReply: {
      label: 'NEEDS YOUR REPLY',
      hint: 'Open conversations flagged for you, all time',
    },
    brandDeals: {
      label: 'BRAND DEALS',
      hint: 'Sponsorship and collaboration offers in this period',
    },
    autoReplies: {
      label: 'REPLIES SENT',
      hintOn: 'Sent for you automatically in this period',
      hintOff: 'Automatic replies are off, so this stays at zero',
    },
    spamBlocked: {
      label: 'SPAM FILTERED',
      hint: 'Spam and scams kept out of your inbox in this period',
    },

    replyModeBanner: {
      title: 'Reply mode',
      manageAction: 'Change reply mode',
    },

    breakdown: {
      title: 'What people asked about',
      subtitle: 'Conversation types in this period, matched to your business profile.',
      distributionTitle: 'Share of conversations',
      sampleTooSmall: 'Percentages appear once you have at least 10 conversations in this period.',
    },
  },
};

export const inbox = {
  title: 'Inbox',
  conversations: 'Conversations',
  accounts: 'Accounts',
  allAccounts: 'All accounts',
  folders: 'Folders',
  selectPrompt: {
    title: 'Pick a conversation',
    body: 'Choose someone on the left to read the history and reply.',
  },
  windowOpen: 'You can reply for the next 24 hours',
  windowClosed: 'You can only reply within 24 hours of their last message. Ask them to message you again.',
  noMessages: 'No messages here yet',
  openInInstagram: 'Open in Instagram',
  clearChat: 'Clear messages',
  deleteConversation: 'Delete conversation',
  autoReplyOn: 'Automatic replies on',
  autoReplyOff: 'Automatic replies off',

  needsReplyBanner: {
    title: 'Needs your reply',
    fallback: 'This one is worth answering yourself.',
  },

  insights: {
    title: 'Conversation insights',
    show: 'Show insights',
    hide: 'Hide insights',
    intent: 'What they want',
    leadQuality: 'Lead quality',
    purchaseIntent: 'Buying intent',
    suggestedAction: 'Suggested next step',
    summary: 'Summary',
    scoreHint: 'Scored from 0 to 100 by reading the conversation.',
  },

  brandDeal: {
    title: 'Brand deal details',
    brand: 'Brand',
    budget: 'Budget',
    deliverables: 'Deliverables',
    deadline: 'Deadline',
    statusLabel: 'Deal stage',
  },

  compose: {
    placeholder: 'Write your reply…',
    hint: 'Write your own reply, or have one drafted for you.',
    draft: 'Draft a reply',
    regenerate: 'Draft another',
    generating: 'Writing…',
    send: 'Send',
    footerManual: 'Suggested replies are never sent on their own. You send them.',
    footerAutomatic: 'Reply mode is set to automatic, so qualifying questions may be answered without you.',
  },
};

export const settings = {
  title: 'Settings',
  subtitle: 'Your business facts, reply tone, and automation.',
  tabs: {
    profile: 'Business profile',
    replies: 'Replies and tone',
    conversations: 'Per-conversation automation',
  },

  businessProfile: {
    title: 'Business profile',
    description: 'Codeback answers customer questions using only what you put here.',
    typesLabel: 'Business types',
    typesHint: 'Pick every type that fits. Tap a card to turn it on or off.',
    selectedCount: 'selected',
    templateBannerPrefix: 'Starter content for',
    applyTemplate: 'Load starter content',
    nameLabel: 'Business name',
    namePlaceholder: 'Apex Visuals Studio',
    descriptionLabel: 'What you do',
    descriptionPlaceholder: 'Short-form video editing for creators and brands.',
    servicesLabel: 'Products and services',
    servicesPlaceholder: 'List what you sell, with enough detail to answer a question about it.',
    pricingLabel: 'Pricing',
    pricingPlaceholder: 'Single reel: INR 1,000. Ten-reel pack: INR 7,500.',
    pricingHint: 'These exact rates are quoted to customers. Nothing else is.',
    policiesLabel: 'Delivery and policies',
    policiesPlaceholder: 'Delivered in 48 hours. Two rounds of revisions included.',
    paymentLabel: 'Payment methods',
    paymentPlaceholder: 'UPI, bank transfer, PayPal',
    faqLabel: 'Common questions',
    faqPlaceholder: 'Q: How do I send footage?\nA: Share a Google Drive or WeTransfer link.',
    prohibitedLabel: 'Never say',
    prohibitedPlaceholder: 'Never promise same-day delivery. Never offer a discount.',
    prohibitedHint: 'Codeback refuses to answer on these topics and hands the conversation to you.',
  },

  replies: {
    title: 'Replies and tone',
    description: 'Decide whether Codeback answers for you, or only drafts.',
    modeLabel: 'Reply mode',
    modeHint: 'Manual is the default. Nothing is ever sent until you switch this.',
    toneLabel: 'Reply tone',
    toneHint: 'The voice used when drafting a reply.',
    instructionsLabel: 'Your own instructions',
    instructionsHint: 'Rules to follow on every reply.',
    instructionsPlaceholder: 'Ask for the footage link before quoting a final price.',
    summariesLabel: 'Conversation summaries',
    summariesHint: 'Keep a running summary on active conversations.',
    summariesOn: 'On',
    summariesOff: 'Off',
  },

  priorities: {
    title: 'Inbox priorities',
    description: 'Decide what rises to the top of your inbox.',
    rows: {
      customersPriority: 'Hot leads and customers',
      brandDealsPriority: 'Brand deals',
      collaborationsPriority: 'Collaborations',
      questionsPriority: 'General questions',
      fanPriority: 'Fan messages',
      spamPriority: 'Spam and scams',
    },
  },

  perConversation: {
    title: 'Per-conversation automation',
    description: 'Turn automatic replies on for one conversation at a time.',
    requiresAutomaticMode: 'Reply mode is manual, so nothing here sends anything yet. Switch reply mode to automatic first.',
    activeCount: 'set to automatic',
    toggleOn: 'Automatic',
    toggleOff: 'Manual',
    searchPlaceholder: 'Search by name, username, or message',
    promptLabel: 'Instructions for this conversation',
    promptPlaceholder: 'Offer this customer the SAVE10 code.',
    savePrompt: 'Save and turn on',
    editPrompt: 'Edit instructions',
    openConversation: 'Open conversation',
    noMessagesYet: 'No messages yet',
  },
};

export const account = {
  title: 'Account',
  subtitle: 'Your details, sign-in, and connected accounts.',
  memberSince: 'Joined',

  details: {
    title: 'Your details',
    description: 'Change your name or password.',
    nameLabel: 'Full name',
    namePlaceholder: 'Your full name',
    emailLabel: 'Email address',
    emailHint: 'Your email cannot be changed here.',
    passwordSection: 'Change password',
    currentPasswordLabel: 'Current password',
    newPasswordLabel: 'New password',
    newPasswordPlaceholder: 'At least 6 characters',
    confirmPasswordLabel: 'Confirm new password',
  },

  businessProfile: {
    title: 'Business profile',
    description: 'What Codeback knows about your business.',
    editAction: 'Edit business profile',
    empty: 'No business profile yet. Add one so Codeback can answer questions about your business.',
    servicesLabel: 'PRODUCTS AND SERVICES',
    pricingLabel: 'PRICING',
    replyModeLabel: 'REPLY MODE',
    toneLabel: 'REPLY TONE',
  },

  connectedAccounts: {
    title: 'Connected accounts',
    description: 'Instagram accounts Codeback reads messages from.',
    connect: 'Connect Instagram',
    empty: 'No connected accounts yet. Connect an Instagram professional account to start.',
    openInbox: 'Open inbox',
  },

  danger: {
    title: 'Delete account',
    body: 'Deleting removes your account, your connected accounts, and every conversation Codeback holds. It cannot be undone.',
    action: 'Delete account',
  },
};

export const auth = {
  login: {
    title: 'Log in to Codeback',
    subtitle: 'Your Instagram inbox, sorted.',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@company.com',
    passwordLabel: 'Password',
    submit: 'Log in',
    submitting: 'Logging in…',
    footer: 'No account yet?',
    footerAction: 'Create one',
  },
  register: {
    title: 'Create your account',
    subtitle: 'Sort your Instagram messages from day one.',
    nameLabel: 'Your name or brand',
    namePlaceholder: 'Sarah Jenkins',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@company.com',
    passwordLabel: 'Password',
    passwordHint: 'At least 6 characters.',
    confirmPasswordLabel: 'Confirm password',
    submit: 'Create account',
    submitting: 'Creating account…',
    footer: 'Already have an account?',
    footerAction: 'Log in',
  },
  forgotPassword: {
    title: 'Reset your password',
    subtitle: 'Enter your email and we will send you a reset link.',
    submit: 'Send reset link',
    sent: 'Check your email for a link to reset your password.',
  },
  resetPassword: {
    title: 'Choose a new password',
    subtitle: 'Pick something you have not used here before.',
    submit: 'Save password',
    success: 'Password changed. Log in with your new password.',
  },
  verifyEmail: {
    title: 'Confirm your email',
    subtitle: 'Open the link we sent to finish setting up your account.',
    resend: 'Resend email',
    success: 'Email confirmed.',
  },
  sessionExpired: {
    title: 'You were logged out',
    body: 'Your session ended. Log in again to pick up where you left off.',
    action: 'Log in',
  },
  logoutSuccess: 'Logged out',
};

export const onboarding = {
  title: 'Set up your business',
  subtitle: 'Three short steps. Codeback uses this to answer customer questions.',
  steps: { identity: 'You', category: 'Business type', knowledge: 'Business facts' },

  step1: {
    title: 'Who are you?',
    description: 'Used to address you and introduce your business.',
    nameLabel: 'Your name',
    namePlaceholder: 'Alex Rivera',
    businessLabel: 'Business name',
    businessPlaceholder: 'PixelCraft Studios',
    businessHint: 'Leave blank if you trade under your own name.',
    next: 'Choose business type',
  },
  step2: {
    title: 'What do you do?',
    description: 'Pick every type that fits. Codeback adapts to all of them.',
    customLabel: 'Describe your business',
    customPlaceholders: [
      'Antique watch restoration',
      'Homemade candle shop',
      'Wedding photography',
      'Personal fitness coaching',
    ],
    next: 'Add business facts',
  },
  step3: {
    title: 'Your business facts',
    description: 'Codeback answers only from what you write here. It never invents a price.',
    banner: 'Starter content loaded for',
    bannerSuffix: 'Edit anything, or keep it.',
    reset: 'Reset to starter',
    toneLabel: 'Reply tone',
    finish: 'Finish setup',
    finishing: 'Saving…',
  },
};

export const marketing = {
  hero: {
    badge: 'Instagram DMs, sorted and answered',
    titleLine1: 'Turn Instagram messages into',
    titleAccent: 'paying customers.',
    description:
      'Codeback reads every message sent to your Instagram business account, tells you which ones are worth your time, and drafts the reply using your real prices and policies.',
    primaryCta: 'Get started free',
    secondaryCta: 'Log in',
  },
  stats: [
    { value: 'Your facts', label: 'Answers use only what you enter' },
    { value: 'Every DM', label: 'Sorted the moment it arrives' },
    { value: 'You approve', label: 'Nothing sends until you allow it' },
  ],
  features: {
    title: 'Built for real businesses',
    subtitle: 'Everything you need to turn Instagram conversations into customers.',
    items: [
      {
        title: 'Your business facts',
        body: 'Enter your prices, packages, delivery times, and policies. Replies quote those and nothing else.',
      },
      {
        title: 'Leads sorted for you',
        body: 'Hot leads, brand deals, and returning customers rise to the top of your inbox automatically.',
      },
      {
        title: 'Spam and scams filtered',
        body: 'Phishing links, password requests, fake payment proof, and bulk promotions are kept out of your way.',
      },
      {
        title: 'Replies when you want them',
        body: 'Draft on demand, or let Codeback answer qualifying questions for you. Manual is the default.',
      },
      {
        title: 'Handed back to you',
        body: 'Frustrated customers, negotiations, and anything unusual come to you with a summary of what they need.',
      },
      {
        title: 'Your data stays yours',
        body: 'Each account is isolated, access tokens are encrypted at rest, and every webhook is signature-checked.',
      },
    ],
  },
  footer: {
    privacy: 'Privacy policy',
    terms: 'Terms of service',
    dataDeletion: 'Delete your data',
    support: 'Support',
  },
};

export const admin = {
  brand: 'Codeback admin',
  panelTitle: 'Admin',
  openApp: 'Open app',
  logOut: 'Log out',

  login: {
    eyebrow: 'ADMIN',
    title: 'Codeback admin',
    subtitle: 'Staff sign-in.',
    usernameLabel: 'Username',
    usernamePlaceholder: 'Enter username',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Enter password',
    submit: 'Log in',
    submitting: 'Checking…',
  },

  nav: {
    dashboard: 'Dashboard',
    users: 'Users',
    accounts: 'Connected accounts',
    support: 'Support lookup',
    settings: 'Settings',
  },

  impersonation: {
    banner: 'You are viewing the app as a customer.',
    exit: 'Stop viewing',
  },

  dashboard: {
    investigate: 'Investigate',
    metrics: {
      users: { label: 'Customers', hint: 'Accounts signed up' },
      accounts: { label: 'Connected accounts', hint: 'Instagram accounts linked' },
      messages: { label: 'Messages today', hint: 'Across every customer' },
      failedWebhooks: { label: 'Failed deliveries', hint: 'Meta deliveries that failed in the last 24 hours' },
    },
    processing: {
      title: 'Message processing',
      subtitle: 'Since the server last restarted. These counters reset on deploy.',
      provider: 'Active provider',
      providerNone: 'None used yet',
      keywordMatches: { label: 'FILTERED WITHOUT A CALL', hint: 'Spam and greetings caught by the keyword filter' },
      totalCalls: { label: 'CALLS MADE', hint: 'successful' },
      failures: { label: 'CALLS FAILED', hint: 'Fell back to an unclassified conversation' },
    },
    backlog: {
      title: 'Processing backlog',
      subtitle: 'All time, across every customer.',
      pending: { label: 'WAITING', hint: 'Messages queued or being read' },
      failed: { label: 'FAILED', hint: 'Messages that could not be read' },
      queueMode: { label: 'QUEUE', hint: 'How background work is being run' },
    },
    recentSignups: {
      title: 'Recent signups',
      viewAll: 'View all customers',
      columns: { user: 'Customer', accounts: 'Connected accounts', joined: 'Joined', action: '' },
      inspect: 'Inspect',
      empty: 'No signups yet.',
    },
  },

  users: {
    searchPlaceholder: 'Search by name, email, or @username',
    exportCsv: 'Export CSV',
    columns: {
      user: 'Customer',
      status: 'Status',
      accounts: 'Connected accounts',
      joined: 'Joined',
      actions: 'Actions',
    },
    empty: 'No customers match that search.',
    noAccounts: 'None connected',
    unnamed: 'No name set',
    noEmail: 'No email set',
    suspended: 'Suspended',
    impersonate: 'View as customer',
    suspend: 'Suspend',
    unsuspend: 'Restore',
    delete: 'Delete',
    paginationLabel: 'Page',
    paginationOf: 'of',
  },

  accounts: {
    searchPlaceholder: 'Search by @username or owner',
    statusAll: 'Every status',
    statusValid: 'Active',
    statusNeedsReconnect: 'Reconnect needed',
    exportCsv: 'Export CSV',
    columns: {
      account: 'Instagram account',
      owner: 'Owner',
      status: 'Connection',
      lastWebhook: 'Last delivery',
      conversations: 'Conversations',
      actions: 'Actions',
    },
    empty: 'No connected accounts match that search.',
    refreshToken: 'Refresh access',
    resubscribe: 'Resubscribe',
    disconnect: 'Disconnect',
    instagramId: 'Instagram ID',
  },

  support: {
    title: 'Support lookup',
    subtitle: 'Find a customer or connected account. Read-only.',
    searchPlaceholder: 'Email address or @username',
    submit: 'Search',
    matchedUsers: 'MATCHED CUSTOMERS',
    matchedAccounts: 'MATCHED ACCOUNTS',
    owner: 'Owner',
    empty: 'Nothing matched that search.',
    inspectorTitle: 'Conversation',
    inspectorClose: 'Close',
    inbound: 'Received',
    outbound: 'Sent',
  },

  settings: {
    adminsTitle: 'ADMINISTRATORS',
    adminsColumns: { name: 'Name', email: 'Email', role: 'Role', granted: 'Granted' },
    environmentTitle: 'SERVER CONFIGURATION',
    rows: {
      port: 'Backend port',
      frontendUrl: 'App address',
      redirectUri: 'Instagram redirect address',
      signatureVerification: 'Webhook signature checks',
      nodeEnv: 'Environment',
    },
    signatureEnforced: 'Enforced',
    signatureSkipped: 'Skipped — test mode',
  },
};

export const errors = {
  generic: "Couldn't complete that. Try again in a moment.",
  network: "Couldn't reach Codeback. Check your connection and try again.",
  loadFailed: "Couldn't load this page. Refresh to try again.",
  notFound: {
    title: 'Page not found',
    body: "That page doesn't exist, or it moved.",
    action: 'Go to dashboard',
  },
  serverError: {
    title: 'Something went wrong',
    body: 'The problem is on our side. Try again in a moment.',
    action: 'Try again',
  },
  offline: {
    title: 'You are offline',
    body: 'Codeback reconnects on its own once your connection is back.',
  },
  rateLimited: "Too many attempts. Wait a few minutes and try again.",

  dashboard: "Couldn't load your dashboard. Refresh to try again.",
  analytics: "Couldn't load analytics. Try refreshing.",
  conversations: "Couldn't load your conversations. Refresh to try again.",
  messages: "Couldn't open that conversation. Try again.",
  sendReply: "Couldn't send your message. Try again.",
  sendWindowClosed: "You can only reply within 24 hours of their last message. Ask them to message you again.",
  generateReply: "Couldn't draft a reply just now. Write your own below.",
  saveSettings: "Couldn't save your settings. Try again.",
  saveProfile: "Couldn't save your details. Try again.",
  passwordMismatch: 'Those passwords do not match.',
  disconnectAccount: "Couldn't disconnect that account. Try again.",
  deleteAccount: "Couldn't delete your account. Try again, or contact support.",
  clearChat: "Couldn't clear those messages. Try again.",
  deleteConversation: "Couldn't delete that conversation. Try again.",
  toggleAutomation: "Couldn't change automatic replies for that conversation. Try again.",
  instagramConnect: "Couldn't connect that Instagram account. Try connecting again.",
  instagramExpired: 'Your Instagram connection expired. Reconnect to start receiving messages again.',
  instagramAlreadyLinked: 'That Instagram account is already connected to another Codeback account.',
  notifications: "Couldn't load your notifications. Refresh to try again.",

  admin: {
    stats: "Couldn't load platform stats. Refresh to try again.",
    users: "Couldn't load customers. Refresh to try again.",
    accounts: "Couldn't load connected accounts. Refresh to try again.",
    settings: "Couldn't load server configuration. Refresh to try again.",
    search: "Couldn't run that search. Try again.",
    conversation: "Couldn't open that conversation. Try again.",
    login: 'That username or password is not right.',
    suspend: "Couldn't change that customer's status. Try again.",
    deleteUser: "Couldn't delete that customer. Try again.",
    impersonate: "Couldn't open the customer view. Try again.",
    exitImpersonate: "Couldn't leave the customer view. Reload the page.",
    refreshToken: "Couldn't refresh access with Meta.",
    resubscribe: "Couldn't resubscribe with Meta.",
    disconnect: "Couldn't disconnect that account. Try again.",
  },

  // Shown on the landing page after a failed Instagram OAuth redirect
  // (see the `?error=` codes backend/src/routes/auth.js redirects with).
  oauthCallback: {
    invalid_oauth_state: "We couldn't complete the Instagram connection. This can happen if your phone opened a different browser partway through — try again while staying in the same browser you're logged into Codeback with.",
    oauth_state_unavailable: "We couldn't start the Instagram connection. Try again in a moment.",
    no_code: 'Instagram sign-in was cancelled before it finished. Try connecting again if that was a mistake.',
    account_already_connected: 'That Instagram account is already connected to another Codeback account.',
    oauth_failed: "Couldn't connect that Instagram account. Try connecting again.",

    // ---- Previously rendered as NOTHING AT ALL ----
    //
    // The backend emits 19 distinct ?error= codes; only five were listed here,
    // and only the landing page read the param. Everything redirected to
    // /profile, /dashboard, /login or /register produced a silent bounce with
    // a blank screen — the user saw a page reload and no explanation.
    email_unverified:
      'Confirm your email address before connecting Instagram. We need a verified address so we can tell you if your connection ever breaks.',
    email_required:
      'Add an email address to your account before connecting Instagram.',
    login_required_to_connect:
      'Log in first — Instagram connects to an existing Codeback account, it is not a way to sign up.',
    session_expired: 'Your session ended. Log in again to continue.',
    missing_scopes:
      "Instagram didn't grant the permissions Codeback needs. Reconnect and accept both — without message access no DMs can arrive.",
    account_blocked:
      'That Instagram account cannot be connected. Contact support if you think this is wrong.',
    account_suspended: 'This account is suspended. Contact support.',
    instagram_cancelled:
      'Instagram sign-in was cancelled before it finished. Try connecting again if that was a mistake.',
    instagram_failed: "Couldn't connect that Instagram account. Try connecting again.",

    // Google flow. Rendered for completeness — Google sign-in is confirmed
    // working, but these must not be silent if they ever do fire.
    google_failed: "Couldn't sign you in with Google. Try again.",
    google_not_configured: 'Google sign-in is not set up on this server.',
    google_cancelled: 'Google sign-in was cancelled.',
    google_no_code: "Google sign-in didn't complete. Try again.",
    google_no_email: 'Google did not share an email address, which Codeback needs.',
    google_invalid_state:
      "We couldn't complete Google sign-in. Try again from the login page.",
    google_email_unverified:
      'Google has not verified that email address, so it cannot be used to sign in here.',
    link_requires_verified_email:
      'An account already uses that email address but has not confirmed it. Log in with your password and confirm your email first, then link Google.',

    generic: "Couldn't connect that Instagram account. Try connecting again.",
  },
};

export const empty = {
  accounts: {
    title: 'No accounts connected',
    body: 'Connect an Instagram professional account to start sorting your messages.',
    action: 'Connect Instagram',
  },
  conversations: {
    title: 'Nothing here yet',
    body: 'No conversations match this folder.',
  },
  conversationsAll: {
    title: 'No conversations yet',
    body: 'New messages appear here the moment someone writes to your Instagram account.',
  },
  messages: {
    title: 'No messages yet',
    body: 'This conversation has no history.',
  },
  notifications: {
    title: 'Nothing to report',
    body: 'Brand deals and conversations that need you will show up here.',
  },
  perConversation: {
    title: 'No conversations yet',
    body: 'Once people message your Instagram account, they appear here.',
  },
  search: {
    title: 'No matches',
    body: 'Try a different name, username, or message.',
  },
  analytics: {
    title: 'Not enough data yet',
    body: 'Charts fill in once messages start arriving.',
  },
  adminUsers: {
    title: 'No customers yet',
    body: 'Signups appear here as they happen.',
  },
  adminAccounts: {
    title: 'No connected accounts',
    body: 'Accounts appear here once a customer connects Instagram.',
  },
};

export const toast = {
  settingsSaved: 'Settings saved',
  profileSaved: 'Your details were saved',
  passwordChanged: 'Password changed',
  replySent: 'Message sent',
  replyCopied: 'Reply copied',
  accountDisconnected: 'Account disconnected',
  accountDeleted: 'Account deleted',
  chatCleared: 'Messages cleared',
  conversationDeleted: 'Conversation deleted',
  automationOn: 'Automatic replies turned on for this conversation',
  automationOff: 'Automatic replies turned off for this conversation',
  notificationsRead: 'All notifications marked read',
  templateLoaded: 'Starter content loaded',
  adminUserSuspended: 'Customer suspended',
  adminUserRestored: 'Customer restored',
  adminUserDeleted: 'Customer deleted',
  adminTokenRefreshed: 'Access refreshed',
  adminResubscribed: 'Webhook resubscribed',
  adminAccountDisconnected: 'Account disconnected',
};

export const confirm = {
  disconnectAccount: {
    title: 'Disconnect this account?',
    body: 'Codeback stops receiving new messages for this account. Your conversation history is kept and returns if you reconnect.',
    action: 'Disconnect',
  },
  deleteAccount: {
    title: 'Delete your account?',
    body: 'This erases your account, every connected Instagram account, and all conversation history. It cannot be undone.',
    items: [
      'Every connected Instagram account and its stored access',
      'Every conversation, message, and summary',
      'Your business profile and reply settings',
      'Every brand deal and lead record',
    ],
    confirmLabel: 'Type DELETE to confirm',
    confirmPlaceholder: 'DELETE',
    confirmWord: 'DELETE',
    confirmMismatch: 'Type DELETE exactly to confirm.',
    action: 'Delete account',
  },
  clearChat: {
    title: 'Clear these messages?',
    body: 'Every message with this contact is removed from Codeback. The contact, lead details, and automation settings stay.',
    action: 'Clear messages',
  },
  deleteConversation: {
    title: 'Delete this conversation?',
    body: 'This removes the whole thread, the message history, the insights, and any extracted deal details. It cannot be undone.',
    action: 'Delete conversation',
  },
  loadTemplate: {
    title: 'Load starter content?',
    body: 'This replaces your description, services, pricing, and common questions with example content you can edit.',
    action: 'Load starter content',
  },
  adminSuspendUser: {
    title: 'Suspend this customer?',
    body: 'They cannot log in until you restore them. Their data is kept.',
    action: 'Suspend',
  },
  adminRestoreUser: {
    title: 'Restore this customer?',
    body: 'They can log in again straight away.',
    action: 'Restore',
  },
  adminDeleteUser: {
    title: 'Delete this customer?',
    body: 'This erases their account, connected Instagram accounts, and every conversation. It cannot be undone.',
    action: 'Delete customer',
  },
  adminImpersonate: {
    title: 'View the app as this customer?',
    body: 'You will see their dashboard and their conversations. This is recorded in the audit log.',
    action: 'View as customer',
  },
  adminDisconnectAccount: {
    title: 'Disconnect this account?',
    body: 'The customer stops receiving new messages until they reconnect.',
    action: 'Disconnect',
  },
};

export const validation = {
  required: 'This field is required.',
  nameTooShort: 'Enter a full name of at least 2 characters.',
  emailInvalid: 'Enter a valid email address.',
  passwordTooShort: 'Use at least 6 characters.',
  passwordMismatch: 'Those passwords do not match.',
  currentPasswordRequired: 'Enter your current password.',
  currentPasswordWrong: 'That current password is not right.',
  emailTaken: 'An account already uses that email address. Log in instead.',
  loginFailed: 'That email or password is not right.',
  accountSuspended: 'This account is suspended. Contact support.',
  messageRequired: 'Write something before sending.',
  confirmWordRequired: 'Type DELETE exactly to confirm.',
};

export const meta = {
  root: {
    title: 'Codeback — Instagram DMs, sorted and answered',
    description:
      'Codeback sorts every message sent to your Instagram business account, flags the ones worth your time, and drafts replies from your real prices and policies.',
  },
  dashboard: { title: 'Dashboard — Codeback', description: 'Your connected accounts and conversation activity.' },
  inbox: { title: 'Inbox — Codeback', description: 'Read and reply to Instagram conversations.' },
  settings: { title: 'Settings — Codeback', description: 'Business profile, reply tone, and automation.' },
  account: { title: 'Account — Codeback', description: 'Your details, sign-in, and connected accounts.' },
  notifications: { title: 'Notifications — Codeback', description: 'Brand deals and conversations that need you.' },
  onboarding: { title: 'Set up your business — Codeback', description: 'Add your business facts so Codeback can answer questions.' },
  login: { title: 'Log in — Codeback', description: 'Log in to your Codeback account.' },
  register: { title: 'Create an account — Codeback', description: 'Create a Codeback account and connect Instagram.' },
  admin: { title: 'Admin — Codeback', description: 'Codeback staff administration.' },
  privacy: { title: 'Privacy policy — Codeback', description: 'How Codeback collects, uses, shares, and deletes data.' },
  terms: { title: 'Terms of service — Codeback', description: 'The terms governing use of Codeback.' },
  dataDeletion: { title: 'Delete your data — Codeback', description: 'How to permanently delete your Codeback and Instagram data.' },
  support: { title: 'Support — Codeback', description: 'Get help with your Codeback account and connected Instagram accounts.' },
};

export const legal = {
  backToHome: 'Back to Codeback',
  lastUpdated: 'Last updated',
  privacyTitle: 'Privacy policy',
  termsTitle: 'Terms of service',
  dataDeletionTitle: 'Delete your data',
  supportTitle: 'Support',
  footerLinks: {
    privacy: 'Privacy',
    terms: 'Terms',
    dataDeletion: 'Data deletion',
    support: 'Support',
  },
};

export const support = {
  intro: 'Get help with your Codeback account, your connected Instagram accounts, or your data.',
  contactTitle: 'Contact us',
  replyTime: 'We usually reply within 24–48 hours. Some requests can take up to 7 days.',
  whatToInclude: {
    title: 'What to include',
    items: [
      'The email address on your Codeback account.',
      'The Instagram username concerned.',
      'A short description or screenshot of the issue.',
    ],
  },
  helpTitle: 'Common questions',
  entries: [
    {
      title: 'Connecting an Instagram professional account',
      body: 'From Dashboard, choose Connect Instagram and authorise Codeback with your Instagram professional (business or creator) account.',
    },
    {
      title: 'Disconnecting an Instagram account',
      body: 'From Dashboard, choose Disconnect next to the connected account. This stops Codeback processing new messages but keeps your conversation history so it reappears if you reconnect.',
    },
    {
      title: 'How automatic replies work',
      body: 'Automatic replies are off by default. Turn them on from Settings → Replies and tone → Reply mode. You can also switch individual conversations to Automatic or Manual from Settings → Per-conversation automation, regardless of the overall reply mode.',
    },
    {
      title: 'Deleting your data',
      body: 'Every way to permanently delete your Codeback data is listed on the',
      href: '/data-deletion',
      linkText: 'data deletion page',
    },
    {
      title: 'I messaged a business that uses Codeback',
      body: 'See',
      href: '/data-deletion#if-you-messaged-a-business',
      linkText: '"If you messaged a business that uses Codeback" on the data deletion page',
    },
  ],
};

const copy = {
  common,
  nav,
  dashboard,
  inbox,
  settings,
  account,
  auth,
  onboarding,
  marketing,
  admin,
  errors,
  empty,
  toast,
  confirm,
  validation,
  meta,
  legal,
  support,
};

export default copy;
