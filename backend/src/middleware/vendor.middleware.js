const ApiError = require('../utils/apiError');
const { PERMISSIONS } = require('../utils/permissions');

// A vendor is a store-manager account: role 'admin' holding ONLY manage_own_store_inventory, with
// an assignedStore (see vendorAuth.controller.js#register, or POST /admin/admins). The /vendor
// routes reuse the admin controllers, which lock such an account to its one store
// (utils/storeScope.js). Anyone with wider permissions would see more than their store there, so
// those accounts are kept out of the vendor API and use the admin panel instead.
function isVendorAccount(user) {
  const perms = user?.permissions || [];
  return user?.role === 'admin'
    && perms.length === 1
    && perms[0] === PERMISSIONS.MANAGE_OWN_STORE_INVENTORY
    && !!user.assignedStore;
}

// Use after `authenticate`.
const requireVendor = (req, res, next) => {
  if (!isVendorAccount(req.user)) throw new ApiError(403, 'This is for vendor (store) accounts only');
  next();
};

module.exports = { isVendorAccount, requireVendor };
