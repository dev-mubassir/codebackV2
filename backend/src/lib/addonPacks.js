/**
 * Add-on DM credit packs (one-time Cashfree PG purchases).
 *
 * Keyed by a short numeric code, not a descriptive slug — Cashfree's
 * order_id allows only 45 characters total, and the encoded order_id
 * already spends 36 of those on the Subscription row's UUID (see
 * cashfreeOrders.js), leaving no room for a longer identifier.
 */
const ADDON_PACKS = {
  1: { dmCredits: 500, priceInPaise: 29900 },
  2: { dmCredits: 1500, priceInPaise: 79900 },
  3: { dmCredits: 3000, priceInPaise: 149900 },
};

function getAddonPack(code) {
  // Plain bracket access resolves inherited Object.prototype members —
  // packCode: "toString"/"constructor"/"valueOf" would return a truthy
  // function instead of null, slipping past the caller's `if (!pack)`
  // rejection with undefined price/dmCredits. Require an OWN key.
  if (!Object.prototype.hasOwnProperty.call(ADDON_PACKS, code)) return null;
  return ADDON_PACKS[code];
}

module.exports = { ADDON_PACKS, getAddonPack };
