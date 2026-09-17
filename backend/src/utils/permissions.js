// Admin RBAC permission keys. The seeded super-admin gets ['*'] (all permissions).
// Staff admins created via POST /admin/admins get an explicit subset of these.
const PERMISSIONS = {
  MANAGE_STORES: 'manage_stores',
  MANAGE_CATALOG: 'manage_catalog',
  MANAGE_INVENTORY: 'manage_inventory',
  // Restricted admin sub-role: scoped to only the one store on that admin's `assignedStore`.
  MANAGE_OWN_STORE_INVENTORY: 'manage_own_store_inventory',
  MANAGE_ORDERS: 'manage_orders',
  MANAGE_PICKERS: 'manage_pickers',
  MANAGE_DELIVERY: 'manage_delivery',
  MANAGE_PROMOTIONS: 'manage_promotions',
  MANAGE_PAYMENTS: 'manage_payments',
  MANAGE_SETTLEMENTS: 'manage_settlements',
  MANAGE_SETTINGS: 'manage_settings',
  MANAGE_ADMINS: 'manage_admins',
  VIEW_REPORTS: 'view_reports',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

module.exports = { PERMISSIONS, ALL_PERMISSIONS };
