// Mirrors backend/src/utils/permissions.js
export const PERMISSIONS = {
  MANAGE_VENDORS: 'manage_vendors',
  MANAGE_STORES: 'manage_stores',
  MANAGE_CATALOG: 'manage_catalog',
  MANAGE_INVENTORY: 'manage_inventory',
  MANAGE_ORDERS: 'manage_orders',
  MANAGE_PICKERS: 'manage_pickers',
  MANAGE_DELIVERY: 'manage_delivery',
  MANAGE_PROMOTIONS: 'manage_promotions',
  MANAGE_PAYMENTS: 'manage_payments',
  MANAGE_SETTLEMENTS: 'manage_settlements',
  MANAGE_SETTINGS: 'manage_settings',
  MANAGE_ADMINS: 'manage_admins',
  VIEW_REPORTS: 'view_reports',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export function hasPermission(userPermissions: string[] | undefined, ...required: string[]): boolean {
  if (!userPermissions) return false;
  if (userPermissions.includes('*')) return true;
  return required.some((p) => userPermissions.includes(p));
}
