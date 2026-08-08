/**
 * Audit Logger — records all administrative actions for accountability and security.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Log an administrative action to the database.
 * 
 * @param {string} adminUserId - ID of the admin user performing the action
 * @param {string} action - Action identifier (e.g., 'USER_SUSPEND', 'ACCOUNT_DISCONNECT', 'TOKEN_REFRESH')
 * @param {string} targetType - Resource type ('USER', 'INSTAGRAM_ACCOUNT', 'SYSTEM')
 * @param {string} targetId - ID of the target resource
 * @param {object|string} details - Additional context/metadata
 * @param {string} ipAddress - Client IP address
 */
async function logAdminAction(adminUserId, action, targetType, targetId = null, details = null, ipAddress = null) {
  try {
    const detailsStr = typeof details === 'object' ? JSON.stringify(details) : details;
    
    await prisma.adminLog.create({
      data: {
        adminUserId,
        action,
        targetType,
        targetId,
        details: detailsStr,
        ipAddress,
      },
    });
  } catch (error) {
    console.error('[AuditLogger] Failed to log admin action:', error.message);
  }
}

module.exports = { logAdminAction };
