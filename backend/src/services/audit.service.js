const { AdminActivityLog } = require('../models');

async function logAdminActivity({ adminId, action, entityType = null, entityId = null, metadata = {} }) {
  try {
    await AdminActivityLog.create({ admin: adminId, action, entityType, entityId, metadata });
  } catch (err) {
    // Audit logging must never break the actual admin action.
    console.error('Failed to write admin activity log:', err.message);
  }
}

module.exports = { logAdminActivity };
