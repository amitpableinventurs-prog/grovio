const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireVendor } = require('../middleware/vendor.middleware');
const upload = require('../middleware/upload.middleware');
const csvUpload = require('../middleware/csvUpload.middleware');
const validate = require('../middleware/validate.middleware');
const { registerVendorRules, vendorLoginRules } = require('../validators/vendor.validator');

const authCtrl = require('../controllers/vendor/vendorAuth.controller');
const storeCtrl = require('../controllers/vendor/store.controller');
// The vendor's screens are the store-manager side of these admin controllers, which already lock a
// store-manager account to its own store (utils/storeScope.js) — reused here, not duplicated.
const dashboardCtrl = require('../controllers/admin/dashboard.controller');
const catalogCtrl = require('../controllers/admin/catalog.controller');
const inventoryCtrl = require('../controllers/admin/inventory.controller');
const ordersCtrl = require('../controllers/admin/orders.controller');
const trackingCtrl = require('../controllers/admin/tracking.controller');
const hubDisplaysCtrl = require('../controllers/admin/hubDisplays.controller');

// Vendor Panel API (the vendor-panel app). Token refresh / logout are the shared /auth/refresh and
// /auth/logout; live order updates come over the socket's store:<id> room.

// Public
router.post('/auth/register', registerVendorRules, validate, authCtrl.register);
router.post('/auth/login', vendorLoginRules, validate, authCtrl.login);

router.use(authenticate, requireVendor);

router.get('/me', authCtrl.me);
router.get('/store', storeCtrl.getMyStore);
router.get('/dashboard', dashboardCtrl.getStats);

// Catalog — categories are set by the admin, products are the vendor's own.
router.get('/categories', catalogCtrl.listCategories);
router.get('/products', catalogCtrl.listAllProducts);
router.post('/products', upload.array('images', 5), catalogCtrl.createProduct);
router.patch('/products/:id', upload.array('images', 5), catalogCtrl.updateProduct);
router.patch('/products/:id/status', catalogCtrl.setProductStatus);
router.delete('/products/:id', catalogCtrl.deleteProduct);

router.get('/inventory', inventoryCtrl.listInventory);
router.get('/inventory/export', inventoryCtrl.exportInventory);
router.post('/inventory/import', csvUpload.single('file'), inventoryCtrl.importInventory);

// Orders where my store is the hub or supplies items. Picker / delivery assignment and refunds stay
// with the admin.
router.get('/orders', ordersCtrl.listOrders);
router.get('/orders/:id', ordersCtrl.getOrderDetail);
router.get('/orders/:id/tracking', trackingCtrl.getOrderTracking);
router.patch('/orders/:id/cancel', ordersCtrl.cancelOrder);
router.patch('/orders/:id/mark-returned', ordersCtrl.markReturned);

// Hub Center screens at my store.
router.get('/hub-displays', storeCtrl.useMyStore, hubDisplaysCtrl.listHubDisplays);
router.post('/hub-displays', storeCtrl.useMyStore, hubDisplaysCtrl.createHubDisplay);
router.delete('/hub-displays/:id', hubDisplaysCtrl.revokeHubDisplay);

module.exports = router;
