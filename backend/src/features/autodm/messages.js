/**
 * Built-in wording, used only where an automation leaves a field empty.
 * Plain text: these are DMs to a customer's followers, not UI copy.
 */

const DEFAULT_OPENER_BUTTON = 'Send me the link';
const DEFAULT_FALLBACK_KEYWORD = 'LINK';
const DEFAULT_FOLLOW_BUTTON = "I've followed";

function defaultOpener(keyword = DEFAULT_FALLBACK_KEYWORD) {
  return `Thanks for your comment! Tap the button below and I'll send you the link. On a computer? Just reply ${keyword}.`;
}

function defaultFollowPrompt(keyword = DEFAULT_FALLBACK_KEYWORD) {
  return `Almost there! Follow this account first, then tap the button below (or reply ${keyword}) and the link is yours.`;
}

const DEFAULT_FOLLOW_FAIL =
  "It looks like you're not following yet, so we can't send this one. Thanks for your interest!";

module.exports = {
  DEFAULT_OPENER_BUTTON,
  DEFAULT_FALLBACK_KEYWORD,
  DEFAULT_FOLLOW_BUTTON,
  DEFAULT_FOLLOW_FAIL,
  defaultOpener,
  defaultFollowPrompt,
};
