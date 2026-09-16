const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const upload = require('../middleware/upload.middleware');
const { PERMISSIONS } = require('../utils/permissions');

const dashboardCtrl = require('../controllers/admin/dashboard.controller');
const usersCtrl = require('../controllers/admin/users.controller');
const storesCtrl = require('../controllers/admin/stores.controller');
const catalogCtrl = require('../controllers/admin/catalog.controller');
const ordersCtrl = require('../controllers/admin/orders.controller');
const couponsCtrl = require('../controllers/admin/coupons.controller');
const bannersCtrl = require('../controllers/admin/banners.controller');
const settingsCtrl = require('../controllers/admin/settings.controller');
const reportsCtrl = require('../controllers/admin/reports.controller');
const supportCtrl = require('../controllers/common/support.controller');
const inventoryCtrl = require('../controllers/admin/inventory.controller');
const paymentsCtrl = require('../controllers/admin/payments.controller');
const settlementsCtrl = require('../controllers/admin/settlements.controller');
const adminsCtrl = require('../controllers/admin/admins.controller');

router.use(authenticate, authorize('admin'));

// Dashboard (visible to any admin)
router.get('/dashboard', dashboardCtrl.getStats);

// Users by role
const p = requirePermission;
router.get('/vendors', p(PERMISSIONS.MANAGE_VENDORS), usersCtrl.listByRole('vendor'));
router.get('/customers', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.VIEW_REPORTS), usersCtrl.listByRole('customer'));
router.get('/pickers', p(PERMISSIONS.MANAGE_PICKERS), usersCtrl.listByRole('picker'));
router.get('/delivery-partners', p(PERMISSIONS.MANAGE_DELIVERY), usersCtrl.listByRole('delivery'));
router.get('/users/:id', p(PERMISSIONS.MANAGE_VENDORS, PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_DELIVERY), usersCtrl.getUserDetail);
router.patch('/vendors/:id/status', p(PERMISSIONS.MANAGE_VENDORS), usersCtrl.updateProfileStatus('vendor'));
router.patch('/pickers/:id/status', p(PERMISSIONS.MANAGE_PICKERS), usersCtrl.updateProfileStatus('picker'));
router.patch('/pickers/:id/assign-store', p(PERMISSIONS.MANAGE_PICKERS), usersCtrl.assignPickerToStore);
router.patch('/delivery-partners/:id/status', p(PERMISSIONS.MANAGE_DELIVERY), usersCtrl.updateProfileStatus('delivery'));
router.patch('/users/:id/active', p(PERMISSIONS.MANAGE_VENDORS, PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_DELIVERY), usersCtrl.toggleActive);

// Stores
router.get('/stores', p(PERMISSIONS.MANAGE_STORES), storesCtrl.listStores);
router.get('/stores/:id', p(PERMISSIONS.MANAGE_STORES), storesCtrl.getStore);
router.patch('/stores/:id', p(PERMISSIONS.MANAGE_STORES), storesCtrl.updateStore);

// Catalog
router.post('/categories', p(PERMISSIONS.MANAGE_CATALOG), upload.single('image'), catalogCtrl.createCategory);
router.get('/categories', p(PERMISSIONS.MANAGE_CATALOG), catalogCtrl.listCategories);
router.patch('/categories/:id', p(PERMISSIONS.MANAGE_CATALOG), upload.single('image'), catalogCtrl.updateCategory);
router.delete('/categories/:id', p(PERMISSIONS.MANAGE_CATALOG), catalogCtrl.deleteCategory);
router.get('/products', p(PERMISSIONS.MANAGE_CATALOG), catalogCtrl.listAllProducts);
router.patch('/products/:id/status', p(PERMISSIONS.MANAGE_CATALOG), catalogCtrl.setProductStatus);

// Orders
router.get('/orders', p(PERMISSIONS.MANAGE_ORDERS), ordersCtrl.listOrders);
router.get('/orders/:id', p(PERMISSIONS.MANAGE_ORDERS), ordersCtrl.getOrderDetail);
router.patch('/orders/:id/assign-picker', p(PERMISSIONS.MANAGE_ORDERS), ordersCtrl.assignPicker);
router.patch('/orders/:id/assign-delivery', p(PERMISSIONS.MANAGE_ORDERS), ordersCtrl.assignDelivery);
router.post('/orders/:id/refund', p(PERMISSIONS.MANAGE_PAYMENTS), paymentsCtrl.issueRefund);

// Coupons / Promotions
router.post('/coupons', p(PERMISSIONS.MANAGE_PROMOTIONS), couponsCtrl.createCoupon);
router.get('/coupons', p(PERMISSIONS.MANAGE_PROMOTIONS), couponsCtrl.listCoupons);
router.patch('/coupons/:id', p(PERMISSIONS.MANAGE_PROMOTIONS), couponsCtrl.updateCoupon);
router.delete('/coupons/:id', p(PERMISSIONS.MANAGE_PROMOTIONS), couponsCtrl.deleteCoupon);

// Banners / Promotions
router.post('/banners', p(PERMISSIONS.MANAGE_PROMOTIONS), upload.single('image'), bannersCtrl.createBanner);
router.get('/banners', p(PERMISSIONS.MANAGE_PROMOTIONS), bannersCtrl.listBanners);
router.patch('/banners/:id', p(PERMISSIONS.MANAGE_PROMOTIONS), upload.single('image'), bannersCtrl.updateBanner);
router.delete('/banners/:id', p(PERMISSIONS.MANAGE_PROMOTIONS), bannersCtrl.deleteBanner);

// Settings
router.get('/settings', p(PERMISSIONS.MANAGE_SETTINGS), settingsCtrl.getSettings);
router.put('/settings', p(PERMISSIONS.MANAGE_SETTINGS), settingsCtrl.updateSettings);

// Reports
router.get('/reports/sales', p(PERMISSIONS.VIEW_REPORTS), reportsCtrl.salesReport);
router.get('/reports/vendor-commission', p(PERMISSIONS.VIEW_REPORTS), reportsCtrl.vendorCommissionReport);
router.get('/reports/products', p(PERMISSIONS.VIEW_REPORTS), reportsCtrl.productReport);
router.get('/reports/customers', p(PERMISSIONS.VIEW_REPORTS), reportsCtrl.customerReport);
router.get('/reports/delivery-partners', p(PERMISSIONS.VIEW_REPORTS), reportsCtrl.deliveryReport);

// Support tickets
router.get('/support-tickets', p(PERMISSIONS.MANAGE_ORDERS), supportCtrl.listAllTickets);
router.patch('/support-tickets/:id', p(PERMISSIONS.MANAGE_ORDERS), supportCtrl.replyToTicket);

// Inventory
router.get('/inventory', p(PERMISSIONS.MANAGE_INVENTORY), inventoryCtrl.listInventory);

// Payments
router.get('/payments', p(PERMISSIONS.MANAGE_PAYMENTS), paymentsCtrl.listPayments);
router.get('/payments/cod-reconciliation', p(PERMISSIONS.MANAGE_PAYMENTS), paymentsCtrl.codReconciliation);
router.get('/refunds', p(PERMISSIONS.MANAGE_PAYMENTS), paymentsCtrl.listRefunds);

// Settlements
router.post('/settlements/generate', p(PERMISSIONS.MANAGE_SETTLEMENTS), settlementsCtrl.generateVendorSettlement);
router.get('/settlements', p(PERMISSIONS.MANAGE_SETTLEMENTS), settlementsCtrl.listSettlements);
router.patch('/settlements/:id/pay', p(PERMISSIONS.MANAGE_SETTLEMENTS), settlementsCtrl.markSettlementPaid);

// RBAC: staff admins + audit log
router.post('/admins', p(PERMISSIONS.MANAGE_ADMINS), adminsCtrl.createAdmin);
router.get('/admins', p(PERMISSIONS.MANAGE_ADMINS), adminsCtrl.listAdmins);
router.patch('/admins/:id/permissions', p(PERMISSIONS.MANAGE_ADMINS), adminsCtrl.updatePermissions);
router.get('/activity-logs', p(PERMISSIONS.MANAGE_ADMINS), adminsCtrl.listActivityLogs);

module.exports = router;
