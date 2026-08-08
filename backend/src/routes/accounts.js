/**
 * Account management routes.
 * 
 * List and disconnect Instagram accounts for the logged-in user.
 */

const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { requireAuth } = require('../middleware/auth');

const prisma = new PrismaClient();

// All routes require authentication
router.use(requireAuth);

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
        createdAt: true,
      },
    });

    if (accounts.length === 0 && process.env.NODE_ENV !== 'production') {
      accounts = await prisma.instagramAccount.findMany({
        select: {
          id: true,
          igUserId: true,
          igUsername: true,
          igName: true,
          igProfilePic: true,
          tokenExpiresAt: true,
          createdAt: true,
        },
      });
    }

    res.json(accounts);
  } catch (error) {
    console.error('[Accounts] Error fetching accounts:', error.message);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// ============================================
// DELETE /api/accounts/:id
// Disconnect an Instagram account (deletes account + all related data)
// ============================================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify the account belongs to the logged-in user
    const account = await prisma.instagramAccount.findFirst({
      where: { id: id, userId: req.userId },
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Cascade delete will remove contacts, conversations, and messages
    await prisma.instagramAccount.delete({
      where: { id: id },
    });

    console.log('[Accounts] Disconnected account:', account.igUsername);
    res.json({ message: 'Account disconnected successfully' });
  } catch (error) {
    console.error('[Accounts] Error disconnecting account:', error.message);
    res.status(500).json({ error: 'Failed to disconnect account' });
  }
});

module.exports = router;
