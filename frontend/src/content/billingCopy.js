/**
 * Strings for the in-app billing page.
 *
 * WHY THIS FILE EXISTS AT ALL: content/copy.js is a single shared file, and
 * both Wave 1 frontend gates would naturally add strings to it — Gate 5 for
 * the billing page, Gate 6 for the marketing pricing section. That is a
 * merge conflict waiting to happen in a file neither of them owns. Splitting
 * it means Gate 5 writes here, Gate 6 writes in copy.js, and neither has to
 * touch the other's.
 *
 * House style is copy.js's, and it applies here too:
 *   - Second person. "You", never "we".
 *   - Sentence case for headings, buttons, labels.
 *   - Buttons 3 words or fewer, verb first.
 *   - No emoji.
 *   - Errors read "Couldn't <action>. <What to do>." — no codes, no blame.
 *
 * NEVER put a price in this file. Prices come from GET /api/billing/plans
 * via lib/pricing.js, so they can change with a database UPDATE and no
 * redeploy. A number written here would silently go stale the first time
 * pricing moves.
 *
 * Strings that need a real number are FUNCTIONS taking the already-formatted
 * value, so the formatting stays in lib/pricing.js / content/format.js and
 * this file still contains no arithmetic and no currency symbols of its own.
 */

export const billing = {
  meta: {
    title: 'Billing',
    description: 'Your plan, your reply credits, and your payment history.',
  },

  page: {
    title: 'Billing',
    subtitle: 'Your plan, your reply credits, and everything you have paid for.',
  },

  status: {
    // Keyed by the effectiveStatus the summary endpoint derives.
    NONE: 'No plan',
    TRIALING: 'Free trial',
    ACTIVE: 'Active',
    GRACE: 'Grace period',
    EXPIRED: 'Expired',
  },

  plan: {
    heading: 'Your plan',
    noPlanTitle: 'You are not on a plan yet',
    noPlanBody: 'Pick a plan below to turn on auto-replies. You pay once, for 30 days, and nothing renews on its own.',
    expiresLabel: 'Expired on',
    renewedUntilLabel: 'Paid until',
    timeLeftLabel: 'Time left',
    instagramLabel: 'Instagram',
    currencyLabel: 'Currency',
    daysLeft: (days) => (days === 1 ? '1 day left' : `${days} days left`),
    graceDaysLeft: (days) =>
      days === 1
        ? 'Auto-replies are paused. You have 1 day to renew before your credits are cleared.'
        : `Auto-replies are paused. You have ${days} days to renew before your credits are cleared.`,
    extraAccounts: (count) => (count === 1 ? '1 extra Instagram account' : `${count} extra Instagram accounts`),
    igAccountsIncluded: (count) => (count === 1 ? '1 Instagram account included' : `${count} Instagram accounts included`),
    regionLocked: (currency) => `Billed in ${currency}`,
  },

  /**
   * The renewal date promise. This is a real commitment the entitlement
   * service keeps (grantPlan anchors a warm renewal on validUntil, not on
   * today), so the page states the resulting date out loud rather than
   * asking anyone to take it on trust.
   */
  renewal: {
    keepsYourDays: (currentExpiry, newExpiry) =>
      `Renewing now does not restart your month. Your ${currentExpiry} expiry moves to ${newExpiry} — you keep every day you have already paid for.`,
    coldStart: (newExpiry) => `Your 30 days start when the payment clears, running to ${newExpiry}.`,
    renewButton: 'Renew plan',
    buyButton: 'Buy plan',
    upgradeButton: 'Upgrade to Pro',
    currentButton: 'Current plan',
  },

  credits: {
    heading: 'Reply credits',
    remaining: 'Replies left',
    current: 'This cycle',
    banked: 'Banked from before',
    bankedHelp: 'Unused replies roll over to your next cycle, up to your plan cap. Banked replies are always spent first.',
    usedThisCycle: (percent) => `${percent}% used this cycle`,
    spentThisCycle: (count) => (count === 1 ? '1 reply sent this cycle' : `${count} replies sent this cycle`),
    empty: 'No replies left',
  },

  usage: {
    heading: 'This cycle',
    classified: 'Messages sorted',
    autoReplies: 'Auto-replies sent',
    cycleStarted: 'Cycle started',
    // Deliberately no ceiling anywhere in this block. The classification cap
    // and hourly throttle are an internal burst guard and are never shown as
    // a number to a customer — see Plan.classificationCapCycle's schema note.
    classifiedHelp: 'Every DM you receive is read and sorted. This does not use a reply credit.',
  },

  /**
   * Banners. All four are IN-APP ONLY. The credit warnings in particular are
   * never emailed: email is a scarce, capped channel reserved for renewal
   * and account-critical mail (see lib/email/quota.js), and "you have used
   * 80% of your replies" is not worth a slot in it.
   */
  banners: {
    creditsLowTitle: 'You have used most of your replies',
    creditsLowBody: (remaining) =>
      remaining === 1
        ? 'You have 1 reply left this cycle. Top up now and auto-replies keep running without a gap.'
        : `You have ${remaining} replies left this cycle. Top up now and auto-replies keep running without a gap.`,
    creditsOutTitle: 'You are out of replies',
    creditsOutBody:
      'Auto-replies have stopped. Your DMs are still being read and sorted — top up to start replying again.',
    expiringTitle: (days) => (days === 1 ? 'Your plan expires tomorrow' : `Your plan expires in ${days} days`),
    expiringBody: 'Renew now and the extra days are added to your current expiry, not to today.',
    graceTitle: 'Your plan has expired',
    graceBody:
      'Auto-replies are paused and your unused replies are still being held. Renew before the grace period ends to keep them.',
    expiredTitle: 'Your plan has ended',
    expiredBody: 'Auto-replies are off and your credit bank has been cleared. Buy a plan to start a fresh cycle.',
    topUpButton: 'Buy replies',
    renewButton: 'Renew now',
  },

  addons: {
    heading: 'Add-ons',
    subheading: 'Priced for your current plan. Add-ons never renew on their own.',
    replyPack: (count) => `+${count.toLocaleString('en-IN')} replies`,
    replyPackHelp: 'Added to this cycle straight away. Unused ones roll over like any other reply.',
    extraIgAccount: '+1 Instagram account',
    extraIgAccountHelp: 'Stays on your account and is included in every renewal from now on.',
    buyReplies: 'Buy replies',
    addAccount: 'Add account',
    needsPlan: 'Add-ons need an active Starter or Pro plan. Buy a plan first.',
  },

  /**
   * The upgrade pitch, shown the moment a Starter tenant's FIRST add-on is
   * paid for. That purchase is the strongest signal available that the plan
   * beneath it is too small, and it is the one moment the saving is a
   * concrete number rather than a hypothetical.
   */
  upsell: {
    // Only ever rendered when proUpgradeVerdict() returns kind 'saving' —
    // i.e. Pro is genuinely cheaper for this tenant AND no worse on replies
    // or accounts. Never write savings language into the comparison strings
    // below; the whole point of the split is that one claim is true and the
    // other would not be.
    title: (saving) => `You would save ${saving} a month on Pro`,
    body: 'Pro includes more replies to begin with, and its add-ons cost less, so the same month works out cheaper.',

    // Shown when Pro is NOT cheaper for them. States what Pro is, and stops.
    comparisonTitle: (replies, accounts, price) =>
      `Pro: ${replies.toLocaleString('en-IN')} replies and ${accounts} accounts for ${price}`,
    comparisonBody:
      'Top-ups cost less on Pro, so it gets cheaper the more you use. At what you are buying now, Starter is still the better value.',

    button: 'Upgrade to Pro',
    dismiss: 'Not now',
  },

  plans: {
    heading: 'Plans',
    subheading: 'Every plan is a single 30-day payment. No auto-debit, no mandate, nothing renews unless you choose to.',
  },

  checkout: {
    title: (planName) => `Checkout — ${planName}`,
    addonTitle: 'Checkout — add-on',
    phoneLabel: 'Mobile number',
    phoneHelp: 'Cashfree needs a 10-digit Indian mobile number to open the payment page. It is not stored on your profile.',
    phonePlaceholder: '10-digit number',
    amountLabel: 'You pay',
    payButton: 'Continue to pay',
    payingButton: 'Opening payment',
    cancelButton: 'Cancel',
    hostedNote: "Payment is handled on Cashfree's own secure page. Your card details never reach Siffty.",
    returningTitle: 'Finishing your payment',
    returningBody: 'Your payment is being confirmed. This page updates itself as soon as it clears.',
    paidTitle: 'Payment received',
    paidBody: 'Your plan and credits are up to date.',
    failedTitle: 'That payment did not go through',
    failedBody: 'Nothing was charged. You can try again whenever you are ready.',
  },

  orders: {
    heading: 'Payment history',
    empty: 'You have not paid for anything yet.',
    columnDate: 'Date',
    columnItem: 'Item',
    columnAmount: 'Amount',
    columnStatus: 'Status',
    planItem: (planName) => `${planName} plan`,
    addonItem: (addonCode) => (addonCode === 'extra_ig_account' ? 'Extra Instagram account' : 'Reply credits'),
    status: {
      CREATED: 'Not completed',
      PAID: 'Paid',
      FAILED: 'Failed',
      EXPIRED: 'Expired',
    },
  },

  /**
   * The two pre-payment states (TrialStateCard). Every number is an argument:
   * they come from summary.trial, which the server reads from the TRIAL
   * catalogue row, so the trial can change without touching this file.
   */
  trial: {
    noneTitle: (days) =>
      days
        ? `Connect an Instagram account to start your ${days}-day free trial`
        : 'Connect an Instagram account to start your free trial',
    noneBody:
      'Your trial starts the moment you connect, not before, so none of it runs out while you are still setting up. No payment details needed.',
    includesHeading: 'Your trial includes',
    includesDays: (days) => (days === 1 ? '1 day of full access' : `${days} days of full access`),
    includesClassified: (limit) => `${limit} messages read and sorted`,
    includesAutoReplies: (count) => (count === 1 ? '1 auto-reply sent for you' : `${count} auto-replies sent for you`),
    connectButton: 'Connect Instagram',
    activeTitle: 'Your free trial',
    endsLabel: 'Trial ends',
    classifiedLabel: 'Messages sorted',
    autoRepliesLabel: 'Auto-replies left',
    ofLimit: (value, limit) => `${value} of ${limit}`,
    sortingLimitReached: (limit) =>
      `You have used all ${limit} trial message sorts. New messages still arrive, but they are not sorted or answered until you pick a plan.`,
    autoRepliesUsedUp: 'You have used every trial auto-reply. Messages are still being sorted until your trial ends.',
    whenItEndsHeading: 'When the trial ends:',
    whenItEnds: (date) =>
      `on ${date}, Siffty stops sorting and answering new messages. They still arrive in your inbox, and nothing is charged — there is no card on file. Pick a plan to switch everything back on.`,
  },

  /** The plan panel on /settings (PlanSummaryPanel). */
  settingsPanel: {
    heading: 'Plan',
    description: 'What you are on, and what is left this cycle.',
    planLabel: 'Plan',
    statusLabel: 'Status',
    timeLeftLabel: 'Time left',
    currentLabel: 'Replies this cycle',
    bankedLabel: 'Banked replies',
    classifiedLabel: 'Sorted this cycle',
    noPlan: 'No plan yet',
    noValue: '—',
    manageLink: 'Manage billing',
    noneHint: 'Connect an Instagram account from your dashboard to start your free trial.',
  },

  noAutoDebit: {
    title: 'Nothing renews on its own',
    body: 'There is no auto-debit and no mandate on your account. You pay once, for 30 days, and you decide each time whether to continue.',
  },

  errors: {
    loadSummary: "Couldn't load your billing details. Refresh the page to try again.",
    loadPlans: "Couldn't load pricing. Refresh the page to try again.",
    startCheckout: "Couldn't start checkout. Try again in a moment.",
    openPaymentPage: "Couldn't open the payment page. Check your connection and try again.",
    invalidPhone: "Couldn't start checkout. Enter a 10-digit mobile number.",
  },

  common: {
    retry: 'Try again',
    refresh: 'Refresh',
  },
};

export default billing;
