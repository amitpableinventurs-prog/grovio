const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

const businessCtrl = require('../controllers/vendor/business.controller');
const storesCtrl = require('../controllers/vendor/stores.controller');
const productsCtrl = require('../controllers/vendor/products.controller');
const ordersCtrl = require('../controllers/vendor/orders.controller');
const reviewsCtrl = require('../controllers/vendor/reviews.controller');
const offersCtrl = require('../controllers/vendor/offers.controller');
const reportsCtrl = require('../controllers/vendor/reports.controller');
const settlementsCtrl = require('../controllers/vendor/settlements.controller');

router.use(authenticate, authorize('vendor'));

// Business profile + dashboard
router.get('/dashboard', businessCtrl.getDashboard);
router.get('/business', businessCtrl.getBusinessProfile);
router.put('/business', upload.fields([{ name: 'documents', maxCount: 5 }]), businessCtrl.updateBusinessProfile);
router.get('/earnings', businessCtrl.getEarnings);

// Stores (a vendor can run multiple stores)
router.post('/stores', storesCtrl.createStore);
router.get('/stores', storesCtrl.listStores);
router.get('/stores/:id', storesCtrl.getStore);
router.put('/stores/:id', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), storesCtrl.updateStore);
router.patch('/stores/:id/status', storesCtrl.updateStoreStatus);

// Products (scoped to a store via storeId in body/query)
router.post('/products', upload.array('images', 5), productsCtrl.createProduct);
router.get('/products', productsCtrl.listMyProducts);
router.patch('/products/:id', upload.array('images', 5), productsCtrl.updateProduct);
router.patch('/products/:id/stock', productsCtrl.updateStock);
router.patch('/products/:id/price', productsCtrl.updatePrice);
router.delete('/products/:id', productsCtrl.deleteProduct);
router.post('/products/:id/variants', productsCtrl.addVariant);
router.patch('/products/:id/variants/:variantId', productsCtrl.updateVariant);
router.delete('/products/:id/variants/:variantId', productsCtrl.deleteVariant);

// Orders
router.get('/orders', ordersCtrl.listOrders);
router.get('/orders/:id', ordersCtrl.getOrderDetail);
router.patch('/orders/:id/accept', ordersCtrl.acceptOrder);
router.patch('/orders/:id/reject', ordersCtrl.rejectOrder);

// Reviews
router.get('/reviews', reviewsCtrl.listReviews);

// Offers (vendor-specific coupons, valid across all of this vendor's stores)
router.post('/offers', offersCtrl.createOffer);
router.get('/offers', offersCtrl.listOffers);
router.patch('/offers/:id', offersCtrl.updateOffer);
router.delete('/offers/:id', offersCtrl.deleteOffer);

// Reports & settlements
router.get('/reports/sales', reportsCtrl.salesReport);
router.get('/settlements', settlementsCtrl.listSettlements);

module.exports = router;
