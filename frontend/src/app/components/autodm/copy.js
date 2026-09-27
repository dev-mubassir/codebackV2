/**
 * Auto DM wording. Kept with the feature (not in content/copy.js) so the
 * whole feature stays in its own folders.
 */

export const autodm = {
  navLabel: 'Auto DM',
  meta: {
    title: 'Auto DM — Siffty',
    description: 'Send a DM automatically when someone comments on your post.',
  },
  pageTitle: 'Auto DM',
  pageSub: 'When someone comments on your post, Siffty sends them a DM with your link.',
  unavailable: {
    title: 'Auto DM is not available on your account yet',
    body: 'It is being rolled out gradually. Nothing is needed from you.',
  },
  noAccount: {
    title: 'Connect Instagram first',
    body: 'Auto DM replies to comments on a connected Instagram professional account.',
    action: 'Connect Instagram',
  },
  reconnect: {
    title: 'Reconnect Instagram to enable Auto DM',
    body: 'Auto DM needs permission to read and reply to comments. Reconnect this account and approve comment access when Instagram asks.',
    action: 'Reconnect Instagram',
  },
  empty: {
    title: 'No automations yet',
    body: 'Create one to send a DM to everyone who comments a keyword on your post.',
  },
  create: 'Create automation',
  account: 'Instagram account',
  loadError: "Couldn't load Auto DM. Try again.",
  toggleError: "Couldn't change that automation. Try again.",
  deleteError: "Couldn't delete that automation. Try again.",
  deleteConfirm: {
    title: 'Delete this automation?',
    body: 'Its run log and image are deleted too. People already waiting for a link will not get one.',
    confirm: 'Delete',
    cancel: 'Cancel',
  },
  columns: {
    automation: 'Automation',
    matched: 'Matched',
    dmsSent: 'DMs sent',
    delivered: 'Delivered',
    waitingFollow: 'Waiting for follow',
    failed: 'Failed',
  },
  actions: { edit: 'Edit', runs: 'Run log', delete: 'Delete' },
  scope: {
    any: 'Any post',
    specific: (n) => `${n} selected post${n === 1 ? '' : 's'}`,
  },
  trigger: {
    any: 'Any comment',
    keywords: (list) => `Keywords: ${list.join(', ')}`,
  },
  active: 'Active',
  paused: 'Paused',

  wizard: {
    newTitle: 'New automation',
    editTitle: 'Edit automation',
    steps: ['Post', 'Trigger', 'Message', 'Options'],
    back: 'Back',
    next: 'Next',
    cancel: 'Cancel',
    saveActivate: 'Save & activate',
    saveChanges: 'Save changes',
    saveError: "Couldn't save the automation. Check the fields and try again.",
    name: 'Automation name',
    nameHint: 'Only you see this.',
    post: {
      heading: 'Which posts?',
      any: 'Any post or reel',
      anyHint: 'Every post, including ones you publish later.',
      specific: 'Specific posts',
      specificHint: 'Pick from your recent posts and reels.',
      loading: 'Loading your posts',
      loadError: "Couldn't load your posts from Instagram.",
      none: 'No posts found on this account.',
      noCaption: 'No caption',
      selected: (n) => `${n} selected`,
    },
    trigger: {
      heading: 'Which comments?',
      any: 'Any comment',
      anyHint: 'Everyone who comments gets the DM (once).',
      keywords: 'Comments with a keyword',
      keywordsHint: 'Whole words, any case. Separate with commas.',
      keywordsLabel: 'Keywords',
      keywordsPlaceholder: 'guide, link, price',
      exclude: 'Exclude words (optional)',
      excludeHint: 'A comment containing any of these never gets a DM.',
      excludePlaceholder: 'spam, scam',
    },
    message: {
      heading: 'What should the DM say?',
      openerLabel: 'First message',
      openerHint: 'Sent as a private reply to the comment. Instagram shows the button on phones only, so keep the "reply LINK" line for people on a computer.',
      buttonLabel: 'Button label',
      fallbackLabel: 'Reply keyword',
      fallbackHint: 'Typing this word gets the link too.',
      mainLabel: 'Message with the link',
      mainHint: 'Sent after they tap the button.',
      image: 'Image (optional)',
      imageHint: 'JPG or PNG, up to 2 MB.',
      imageChoose: 'Choose image',
      imageRemove: 'Remove image',
      imageUploading: 'Uploading',
      imageTooBig: 'That image is larger than 2 MB.',
      imageWrongType: 'Only JPG and PNG images are supported.',
      imageError: "Couldn't upload that image.",
      linkLabel: 'Link (optional)',
      linkPlaceholder: 'https://',
      linkHint: 'Must start with https://',
      linkButtonLabel: 'Link button label',
      preview: 'DM preview',
      previewTap: 'Tap',
    },
    options: {
      heading: 'Options',
      follow: 'Only send the link to followers',
      followHint: "Siffty checks whether they follow you. Not following yet? They're asked to follow and tap again (3 tries).",
      followPrompt: 'Follow request message',
      followButton: '"I followed" button label',
      followFail: 'Message after 3 tries (optional)',
      publicReply: 'Also reply publicly to the comment',
      publicReplyHint: 'Up to 3 replies; one is picked at random each time.',
      publicReplyN: (n) => `Public reply ${n}`,
      addReply: 'Add another reply',
      removeReply: 'Remove',
    },
    errors: {
      name: 'Give the automation a name.',
      posts: 'Pick at least one post.',
      keywords: 'Add at least one keyword.',
      opener: 'Write the first message.',
      main: 'Write the message with the link.',
      link: 'The link must be a full https:// address.',
      linkLabel: 'Add a label for the link button.',
      publicReplies: 'Add at least one public reply.',
      tooLong: (n) => `Use at most ${n} characters.`,
    },
  },

  runs: {
    title: 'Run log',
    sub: 'The last 50 comments this automation answered.',
    back: 'All automations',
    refresh: 'Refresh',
    empty: {
      title: 'No runs yet',
      body: 'When someone comments and matches this automation, it shows up here.',
    },
    columns: { commenter: 'Commenter', comment: 'Comment', status: 'Status', sent: 'What was sent', time: 'Time' },
    sent: {
      publicReply: 'Public reply',
      opener: 'First DM',
      image: 'Image',
      link: 'Link message',
      followChecks: (n) => `${n} follow check${n === 1 ? '' : 's'}`,
    },
    viaPoll: 'found by polling',
  },
};

/** Run status → label and badge tone. Warning is kept for things the user must act on. */
export const RUN_STATUS = {
  QUEUED: { label: 'Queued', tone: 'neutral' },
  OPENER_SENT: { label: 'DM sent', tone: 'accent' },
  OPENER_UNCONFIRMED: { label: 'DM not confirmed', tone: 'neutral' },
  AWAITING_FOLLOW: { label: 'Waiting for follow', tone: 'accent' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  NOT_FOLLOWING: { label: 'Not following', tone: 'neutral' },
  FAILED: { label: 'Failed', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

/** last_error codes → plain words. Unknown codes read as a generic failure. */
export function runNote(code) {
  if (!code) return null;
  if (code === 'FAIL_OPEN') return 'Follow status unavailable, so the link was sent anyway.';
  if (code === 'OPENER_UNCONFIRMED') return "Instagram didn't confirm the first DM. It is not resent (one private reply per comment); a tap or keyword reply still works.";
  if (code === 'ACCOUNT_DISCONNECTED') return 'The Instagram account was disconnected.';
  if (code === 'NO_TOKEN' || code.startsWith('META_190')) return 'Instagram needs to be reconnected.';
  if (code === 'NO_RECIPIENT') return 'Instagram did not confirm who received the first DM.';
  if (code === 'NETWORK') return 'Instagram could not be reached.';
  if (code.startsWith('META_')) return `Instagram refused the message (${code.replace('META_', 'code ')}).`;
  return 'Something went wrong sending this DM.';
}
