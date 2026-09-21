const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const upload = require('../middleware/upload.middleware');
const csvUpload = require('../middleware/csvUpload.middleware');
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
const pickersCtrl = require('../controllers/admin/pickers.controller');
const deliveryPartnersCtrl = require('../controllers/admin/deliveryPartners.controller');
const scannerLogsCtrl = require('../controllers/admin/scannerLogs.controller');
const contentPagesCtrl = require('../controllers/admin/contentPages.controller');

router.use(authenticate, authorize('admin'));

// Dashboard (visible to any admin)
router.get('/dashboard', dashboardCtrl.getStats);

// Users by role
const p = requirePermission;
router.get('/customers', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.VIEW_REPORTS), usersCtrl.listByRole('customer'));
router.get('/pickers', p(PERMISSIONS.MANAGE_PICKERS), usersCtrl.listByRole('picker'));
router.post(
  '/pickers',
  p(PERMISSIONS.MANAGE_PICKERS),
  upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'idProofDocument', maxCount: 1 }]),
  pickersCtrl.createPicker
);
router.put(
  '/pickers/:id',
  p(PERMISSIONS.MANAGE_PICKERS),
  upload.fields([{ name: 'profilePhoto', maxCount: 1 }, { name: 'idProofDocument', maxCount: 1 }]),
  pickersCtrl.updatePicker
);
router.get('/delivery-partners', p(PERMISSIONS.MANAGE_DELIVERY), usersCtrl.listByRole('delivery'));
router.post('/delivery-partners', p(PERMISSIONS.MANAGE_DELIVERY), deliveryPartnersCtrl.createDeliveryPartner);
router.put('/delivery-partners/:id', p(PERMISSIONS.MANAGE_DELIVERY), deliveryPartnersCtrl.updateDeliveryPartner);
router.delete('/delivery-partners/:id', p(PERMISSIONS.MANAGE_DELIVERY), deliveryPartnersCtrl.deleteDeliveryPartner);
router.get('/users/:id', p(PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_DELIVERY), usersCtrl.getUserDetail);
router.patch('/pickers/:id/status', p(PERMISSIONS.MANAGE_PICKERS), usersCtrl.updateProfileStatus('picker'));
router.patch('/pickers/:id/assign-store', p(PERMISSIONS.MANAGE_PICKERS), usersCtrl.assignPickerToStore);
router.patch('/delivery-partners/:id/status', p(PERMISSIONS.MANAGE_DELIVERY), usersCtrl.updateProfileStatus('delivery'));
router.patch('/users/:id/active', p(PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_DELIVERY), usersCtrl.toggleActive);

// Stores (admin-owned — no vendor/store login)
router.post(
  '/stores',
  p(PERMISSIONS.MANAGE_STORES),
  upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'banner', maxCount: 1 }]),
  storesCtrl.createStore
);
router.get('/stores', p(PERMISSIONS.MANAGE_STORES, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), storesCtrl.listStores);
router.get('/stores/:id', p(PERMISSIONS.MANAGE_STORES, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), storesCtrl.getStore);
router.patch(
  '/stores/:id',
  p(PERMISSIONS.MANAGE_STORES),
  upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'banner', maxCount: 1 }]),
  storesCtrl.updateStore
);

// Catalog (categories stay full-admin-only; products/inventory also allow the
// store-scoped MANAGE_OWN_STORE_INVENTORY sub-role — see catalog.controller.js for the scoping)
router.post('/categories', p(PERMISSIONS.MANAGE_CATALOG), upload.single('image'), catalogCtrl.createCategory);
router.get('/categories', p(PERMISSIONS.MANAGE_CATALOG, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), catalogCtrl.listCategories);
router.patch('/categories/:id', p(PERMISSIONS.MANAGE_CATALOG), upload.single('image'), catalogCtrl.updateCategory);
router.delete('/categories/:id', p(PERMISSIONS.MANAGE_CATALOG), catalogCtrl.deleteCategory);
router.get('/products', p(PERMISSIONS.MANAGE_CATALOG, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), catalogCtrl.listAllProducts);
router.post(
  '/products',
  p(PERMISSIONS.MANAGE_CATALOG, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY),
  upload.array('images', 5),
  catalogCtrl.createProduct
);
router.patch(
  '/products/:id',
  p(PERMISSIONS.MANAGE_CATALOG, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY),
  upload.array('images', 5),
  catalogCtrl.updateProduct
);
router.patch(
  '/products/:id/status',
  p(PERMISSIONS.MANAGE_CATALOG, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY),
  catalogCtrl.setProductStatus
);
router.delete(
  '/products/:id',
  p(PERMISSIONS.MANAGE_CATALOG, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY),
  catalogCtrl.deleteProduct
);

// Orders (store-manager sub-role — MANAGE_OWN_STORE_INVENTORY + assignedStore — can view and
// accept/reject orders for just their own store; picker/delivery assignment stays admin-only)
router.get('/orders', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.listOrders);
router.get('/orders/:id', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.getOrderDetail);
router.patch('/orders/:id/accept', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.acceptOrder);
router.patch('/orders/:id/reject', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.rejectOrder);
router.patch('/orders/:id/cancel', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.cancelOrder);
router.patch('/orders/:id/mark-returned', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.markReturned);
router.patch('/orders/:id/assign-picker', p(PERMISSIONS.MANAGE_ORDERS), ordersCtrl.assignPicker);
router.patch('/orders/:id/assign-delivery', p(PERMISSIONS.MANAGE_ORDERS), ordersCtrl.assignDelivery);
router.post('/orders/:id/refund', p(PERMISSIONS.MANAGE_PAYMENTS), paymentsCtrl.issueRefund);

// Scanner logs — every Picker/Delivery handover QR scan attempt, success or failure (section 18
// of the delivery-panel spec). Not exposed to the store-scoped MANAGE_OWN_STORE_INVENTORY
// sub-role — this list isn't filtered by store, so scoping it there would leak other stores' logs.
router.get('/scanner-logs', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_DELIVERY), scannerLogsCtrl.listScannerLogs);

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

// Content Pages (About Us, Privacy Policy, Terms & Conditions — served publicly via
// GET /common/content/:slug)
router.get('/content-pages', p(PERMISSIONS.MANAGE_SETTINGS), contentPagesCtrl.listContentPages);
router.get('/content-pages/:slug', p(PERMISSIONS.MANAGE_SETTINGS), contentPagesCtrl.getContentPage);
router.put('/content-pages/:slug', p(PERMISSIONS.MANAGE_SETTINGS), contentPagesCtrl.updateContentPage);

// Reports
router.get('/reports/sales', p(PERMISSIONS.VIEW_REPORTS), reportsCtrl.salesReport);
router.get('/reports/products', p(PERMISSIONS.VIEW_REPORTS), reportsCtrl.productReport);
router.get('/reports/customers', p(PERMISSIONS.VIEW_REPORTS), reportsCtrl.customerReport);
router.get('/reports/delivery-partners', p(PERMISSIONS.VIEW_REPORTS), reportsCtrl.deliveryReport);

// Support tickets
router.get('/support-tickets', p(PERMISSIONS.MANAGE_ORDERS), supportCtrl.listAllTickets);
router.patch('/support-tickets/:id', p(PERMISSIONS.MANAGE_ORDERS), supportCtrl.replyToTicket);

// Inventory
router.get('/inventory', p(PERMISSIONS.MANAGE_INVENTORY, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), inventoryCtrl.listInventory);
router.get('/inventory/export', p(PERMISSIONS.MANAGE_INVENTORY, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), inventoryCtrl.exportInventory);
router.post('/inventory/import', p(PERMISSIONS.MANAGE_INVENTORY, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), csvUpload.single('file'), inventoryCtrl.importInventory);

// Payments
router.get('/payments', p(PERMISSIONS.MANAGE_PAYMENTS), paymentsCtrl.listPayments);
router.get('/payments/cod-reconciliation', p(PERMISSIONS.MANAGE_PAYMENTS), paymentsCtrl.codReconciliation);
router.get('/refunds', p(PERMISSIONS.MANAGE_PAYMENTS), paymentsCtrl.listRefunds);

// Settlements (picker/delivery payouts only — there is no vendor to settle with anymore)
router.get('/settlements', p(PERMISSIONS.MANAGE_SETTLEMENTS), settlementsCtrl.listSettlements);
router.patch('/settlements/:id/pay', p(PERMISSIONS.MANAGE_SETTLEMENTS), settlementsCtrl.markSettlementPaid);

// RBAC: staff admins + audit log
router.post('/admins', p(PERMISSIONS.MANAGE_ADMINS), adminsCtrl.createAdmin);
router.get('/admins', p(PERMISSIONS.MANAGE_ADMINS), adminsCtrl.listAdmins);
router.patch('/admins/:id/permissions', p(PERMISSIONS.MANAGE_ADMINS), adminsCtrl.updatePermissions);
router.get('/activity-logs', p(PERMISSIONS.MANAGE_ADMINS), adminsCtrl.listActivityLogs);

module.exports = router;
