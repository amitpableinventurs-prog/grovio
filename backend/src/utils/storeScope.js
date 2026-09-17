const ApiError = require('./apiError');
const { PERMISSIONS } = require('./permissions');

// True for a super-admin ('*') or anyone holding the full, platform-wide permission.
function hasFullAccess(user, fullPermission) {
  const perms = user.permissions || [];
  return perms.includes('*') || perms.includes(fullPermission);
}

// Resolves which store a catalog/inventory request may act on.
// - Full-access admins may pass any storeId (or none, for unscoped list queries).
// - A restricted inventory-manager (MANAGE_OWN_STORE_INVENTORY + assignedStore) is
//   locked to their own store: an explicit storeId for a different store is rejected,
//   and an omitted storeId is filled in with their assigned store.
function resolveStoreScope(user, requestedStoreId) {
  if (hasFullAccess(user, PERMISSIONS.MANAGE_CATALOG)) return requestedStoreId || null;

  if (!user.assignedStore) {
    throw new ApiError(403, 'Your account is not assigned to a store yet — contact an admin.');
  }
  if (requestedStoreId && requestedStoreId.toString() !== user.assignedStore.toString()) {
    throw new ApiError(403, 'You can only manage inventory for your assigned store.');
  }
  return user.assignedStore.toString();
}

module.exports = { hasFullAccess, resolveStoreScope };
