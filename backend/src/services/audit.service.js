const { AdminActivityLog } = require('../models');
const { logServerError } = require('./errorLog.service');

async function logAdminActivity({ adminId, action, entityType = null, entityId = null, metadata = {} }) {
  try {
    await AdminActivityLog.create({ admin: adminId, action, entityType, entityId, metadata });
  } catch (err) {
    // Audit logging must never break the actual admin action.
    logServerError('Failed to write admin activity log', err);
  }
}

module.exports = { logAdminActivity };
