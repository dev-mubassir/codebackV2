/**
 * Account management routes.
 *
 * List, disconnect, and reconnect-status Instagram accounts for the
 * logged-in user.
 *
 * IMPORTANT: Disconnecting an Instagram account from Codeback NEVER deletes
 * historical conversations/messages/contacts. It only flips the account's
 * connectionStatus to DISCONNECTED. Reconnecting the same Instagram account
 * later (via OAuth) re-activates the same row (igUserId is globally unique)
 * and all history reappears automatically. A separate, explicit "erase all
 * data" action is required to actually delete history.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requireWorkspace } = require('../middleware/authorize');

// All routes require authentication
// The canonical chain. requireWorkspace resolves the caller's owned
// Instagram account ids once and attaches them, so handlers scope on
// req.ownedAccountIds rather than each re-deriving ownership.
router.use(requireAuth);
router.use(requireWorkspace);

// ============================================
// GET /api/accounts
// List all connected Instagram accounts for the logged-in user
// ============================================
router.get('/', async (req, res) => {
  try {
    let accounts = await prisma.instagramAccount.findMany({
      where: { userId: req.userId },
      select: {
        id: true,
        igUserId: true,
        igUsername: true,
        igName: true,
        igProfilePic: true,
        tokenExpiresAt: true,
        tokenStatus: true,
        connectionStatus: true,
        disconnectedAt: true,
        lastWebhookAt: true,
        createdAt: true,
        _count: { select: { conversations: true } },
      },
    });

    // NOTE: The old dev-mode fallback that returned ALL accounts when the
    // user had none has been removed — it leaked every other user's
    // Instagram account details into the current user's view.

    res.json(accounts);
  } catch (error) {
    console.error('[Accounts] Error fetching accounts:', error.message);
    res.status(500).json({ error: "Couldn't load your connected accounts. Refresh to try again." });
  }
});

// ============================================
// DELETE /api/accounts/:id
// Disconnect an Instagram account.
//
// By default this is a SOFT disconnect — it stops treating the account as
// actively connected but keeps every contact/conversation/message intact so
// the creator never loses history. Pass ?purge=true to permanently erase
// all data for this account instead (irreversible).
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const purge = req.query.purge === 'true';

    // Verify the account belongs to the logged-in user
    const account = await prisma.instagramAccount.findFirst({
      where: { id: id, userId: req.userId },
    });

    if (!account) {
      return res.status(404).json({ error: 'That account no longer exists.' });
    }

    // There is no supported Graph API call to revoke this token from here —
    // DELETE /{ig-user-id}/permissions returns "Unsupported delete request"
    // for this product (Instagram API with Instagram Login); the documented
    // model is that the USER revokes access from inside Instagram, not the
    // app via API. A long-lived token attached to the account can therefore
    // remain live at Meta for up to 60 days after this disconnect — the
    // tombstoning below only stops CODEBACK from using it.
    if (purge) {
      // Explicit, irreversible data deletion — cascades to contacts,
      // conversations, messages, AI analyses, brand deals, etc.
      //
      // The InstagramIdentity ledger row is NOT touched: it has no relation to
      // this table precisely so that deleting an account cannot reset a
      // consumed trial. Purging is a data-deletion right, not a way to get a
      // second free trial.
      await prisma.instagramAccount.delete({ where: { id: id } });
      console.log('[Accounts] Purged account and all historical data:', account.igUsername);
      return res.json({ message: 'Account and its history deleted' });
    }

    await prisma.instagramAccount.update({
      where: { id: id },
      data: {
        connectionStatus: 'DISCONNECTED',
        disconnectedAt: new Date(),
        // Clear the stored token. Once revoked it is useless, and keeping a
        // dead secret at rest has no upside. Both representations are cleared;
        // access_token is NOT NULL until the D3 cleanup migration, so it gets
        // an explicit tombstone rather than null.
        accessToken: 'revoked',
        tokenCiphertext: null,
        tokenIv: null,
        tokenAuthTag: null,
        tokenStatus: 'NEEDS_RECONNECT',
      },
    });

    console.log('[Accounts] Disconnected account (history preserved):', account.igUsername);
    res.json({ message: 'Account disconnected. Your conversation history is kept and returns if you reconnect.' });
  } catch (error) {
    console.error('[Accounts] Error disconnecting account:', error.message);
    res.status(500).json({ error: "Couldn't disconnect that account. Try again." });
  }
});

module.exports = router;
