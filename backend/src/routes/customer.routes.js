const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');

const homeCtrl = require('../controllers/customer/home.controller');
const catalogCtrl = require('../controllers/customer/catalog.controller');
const cartCtrl = require('../controllers/customer/cart.controller');
const addressCtrl = require('../controllers/customer/address.controller');
const ordersCtrl = require('../controllers/customer/orders.controller');
const walletCtrl = require('../controllers/customer/wallet.controller');
const couponsCtrl = require('../controllers/customer/coupons.controller');
const reviewsCtrl = require('../controllers/customer/reviews.controller');
const supportCtrl = require('../controllers/common/support.controller');

router.use(authenticate, authorize('customer'));

// Home / catalog
router.get('/home', homeCtrl.getHome);
router.get('/categories', catalogCtrl.listCategories);
router.get('/stores', catalogCtrl.listStores);
router.get('/stores/:id', catalogCtrl.getStoreDetail);
router.get('/products', catalogCtrl.listProducts);
router.get('/products/:id', catalogCtrl.getProductDetail);

// Cart
router.get('/cart', cartCtrl.getCart);
router.post('/cart/items', cartCtrl.addToCart);
router.patch('/cart/items/:id', cartCtrl.updateCartItem);
router.delete('/cart/items/:id', cartCtrl.removeCartItem);
router.delete('/cart', cartCtrl.clearCart);
router.post('/cart/apply-coupon', cartCtrl.applyCoupon);
router.delete('/cart/coupon', cartCtrl.removeCoupon);

// Addresses
router.get('/addresses', addressCtrl.listAddresses);
router.post('/addresses', addressCtrl.createAddress);
router.put('/addresses/:id', addressCtrl.updateAddress);
router.delete('/addresses/:id', addressCtrl.deleteAddress);

// Checkout / Orders
router.post('/checkout/summary', ordersCtrl.checkoutSummary);
router.post('/orders', ordersCtrl.placeOrder);
router.get('/orders', ordersCtrl.listOrders);
router.get('/orders/:id', ordersCtrl.getOrderDetail);
router.get('/orders/:id/tracking', ordersCtrl.getTracking);
router.get('/orders/:id/delivery-pin', ordersCtrl.getDeliveryPin);
router.post('/orders/:id/cancel', ordersCtrl.cancelOrder);
router.post('/orders/:orderId/rating', reviewsCtrl.submitReview);

// Wallet
router.get('/wallet', walletCtrl.getWallet);
router.get('/wallet/transactions', walletCtrl.getTransactions);

// Coupons
router.get('/coupons', couponsCtrl.listAvailableCoupons);

// Support
router.post('/support/tickets', supportCtrl.createTicket);

module.exports = router;
