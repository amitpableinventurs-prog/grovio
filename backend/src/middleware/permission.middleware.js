const ApiError = require('../utils/apiError');

// Use after `authenticate` + `authorize('admin')`. Requires the admin to have '*'
// (super-admin) or at least one of the listed permissions.
const requirePermission = (...perms) => (req, res, next) => {
  const userPerms = req.user.permissions || [];
  if (userPerms.includes('*') || perms.some((p) => userPerms.includes(p))) {
    return next();
  }
  throw new ApiError(403, `Missing required permission: ${perms.join(' or ')}`);
};

module.exports = { requirePermission };
