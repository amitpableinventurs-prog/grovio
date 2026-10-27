const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/permission.middleware');
const upload = require('../middleware/upload.middleware');
const csvUpload = require('../middleware/csvUpload.middleware');
const validate = require('../middleware/validate.middleware');
const { bankRules } = require('../validators/delivery.validator');
const { PERMISSIONS } = require('../utils/permissions');

// Delivery partner create/edit: the payout bank section is optional, but checked when filled in.
const adminBankRules = bankRules('bankDetails.', { optional: true });

const dashboardCtrl = require('../controllers/admin/dashboard.controller');
const usersCtrl = require('../controllers/admin/users.controller');
const storesCtrl = require('../controllers/admin/stores.controller');
const catalogCtrl = require('../controllers/admin/catalog.controller');
const ordersCtrl = require('../controllers/admin/orders.controller');
const couponsCtrl = require('../controllers/admin/coupons.controller');
const bannersCtrl = require('../controllers/admin/banners.controller');
const settingsCtrl = require('../controllers/admin/settings.controller');
const orderSettingsCtrl = require('../controllers/admin/orderSettings.controller');
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
const hubDisplaysCtrl = require('../controllers/admin/hubDisplays.controller');
const trackingCtrl = require('../controllers/admin/tracking.controller');
const ivrCtrl = require('../controllers/admin/ivr.controller');
const voipCtrl = require('../controllers/admin/voip.controller');
const sosCtrl = require('../controllers/admin/sos.controller');
const announcementsCtrl = require('../controllers/admin/announcements.controller');
const pickerPayCtrl = require('../controllers/admin/pickerPay.controller');
const riderPayCtrl = require('../controllers/admin/riderPay.controller');
const programsCtrl = require('../controllers/admin/riderPrograms.controller');
const { gigBulkRules, gigUpdateRules, offerRules, earningAdjustmentRules, deductionRules, cashDepositRules, announcementRules } = require('../validators/programs.validator');

router.use(authenticate, authorize('admin'));

// Dashboard (visible to any admin)
router.get('/dashboard', dashboardCtrl.getStats);

// Users by role
const p = requirePermission;
router.get('/customers', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.VIEW_REPORTS), usersCtrl.listByRole('customer'));
router.delete('/customers/:id', p(PERMISSIONS.MANAGE_ORDERS), usersCtrl.deleteCustomer);
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
router.post('/delivery-partners', p(PERMISSIONS.MANAGE_DELIVERY), adminBankRules, validate, deliveryPartnersCtrl.createDeliveryPartner);
router.put('/delivery-partners/:id', p(PERMISSIONS.MANAGE_DELIVERY), adminBankRules, validate, deliveryPartnersCtrl.updateDeliveryPartner);
router.delete('/delivery-partners/:id', p(PERMISSIONS.MANAGE_DELIVERY), deliveryPartnersCtrl.deleteDeliveryPartner);
router.get('/users/:id', p(PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_DELIVERY), usersCtrl.getUserDetail);
router.patch('/pickers/:id/status', p(PERMISSIONS.MANAGE_PICKERS), usersCtrl.updateProfileStatus('picker'));
router.patch('/pickers/:id/assign-store', p(PERMISSIONS.MANAGE_PICKERS), usersCtrl.assignPickerToStore);
router.patch('/delivery-partners/:id/status', p(PERMISSIONS.MANAGE_DELIVERY), usersCtrl.updateProfileStatus('delivery'));
// Delivery partner programs: gigs (bookable shifts), incentive offers and extra earnings — the
// data behind the delivery app's Gigs / Offers / Earnings screens.
router.get('/gigs', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.listGigs);
router.post('/gigs/bulk', p(PERMISSIONS.MANAGE_DELIVERY), gigBulkRules, validate, programsCtrl.bulkCreateGigs);
router.patch('/gigs/:id', p(PERMISSIONS.MANAGE_DELIVERY), gigUpdateRules, validate, programsCtrl.updateGig);
router.delete('/gigs/:id', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.cancelGig);
router.get('/gigs/:id/bookings', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.gigBookings);
router.patch('/gig-bookings/:id/exempt', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.exemptBooking);
router.get('/offers', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.listOffers);
router.post('/offers', p(PERMISSIONS.MANAGE_DELIVERY), offerRules, validate, programsCtrl.createOffer);
router.get('/offers/:id', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.getOffer);
router.put('/offers/:id', p(PERMISSIONS.MANAGE_DELIVERY), offerRules, validate, programsCtrl.updateOffer);
router.delete('/offers/:id', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.cancelOffer);
router.get('/offers/:id/riders', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.offerRiders);
router.post('/offers/:id/settle', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.settleOffer);
router.post('/delivery-partners/:id/earnings', p(PERMISSIONS.MANAGE_DELIVERY), earningAdjustmentRules, validate, programsCtrl.addEarning);
// Delivery partner pocket: deductions, cash handed in at the hub, withdrawals / weekly payouts.
router.post('/delivery-partners/:id/deductions', p(PERMISSIONS.MANAGE_DELIVERY), deductionRules, validate, programsCtrl.addDeduction);
router.post('/delivery-partners/:id/cash-deposits', p(PERMISSIONS.MANAGE_DELIVERY), cashDepositRules, validate, programsCtrl.recordCashDeposit);
router.get('/delivery-partners/:id/cash-ledger', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTLEMENTS), programsCtrl.cashLedger);
router.get('/cash-collection', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTLEMENTS), programsCtrl.cashCollection);
router.get('/pocket-transfers', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTLEMENTS), programsCtrl.listPocketTransfers);
router.post('/pocket-transfers/weekly-payouts', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTLEMENTS), programsCtrl.runWeeklyPayouts);
router.patch('/pocket-transfers/:id', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTLEMENTS), programsCtrl.updatePocketTransfer);
// Account holds ("Face not matching" etc.), selfie checks, cold bags.
router.post('/delivery-partners/:id/hold', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.holdAccount);
router.post('/delivery-partners/:id/unhold', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.unholdAccount);
router.get('/delivery-partners/:id/holds', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.listHolds);
router.get('/selfie-checks', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.listSelfieChecks);
router.patch('/selfie-checks/:id', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.reviewSelfieCheck);
router.post('/cold-bags', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_INVENTORY), programsCtrl.createColdBags);
router.get('/cold-bags', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_INVENTORY), programsCtrl.listColdBags);
router.get('/cold-bags/overdue', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.overdueColdBags);
router.patch('/cold-bag-issues/:id/lost', p(PERMISSIONS.MANAGE_DELIVERY), programsCtrl.markColdBagLost);
// Delivery partner KM + incentive pay: rate card, preview, hub rain / surge, daily / weekly periods.
router.get('/rider-pay/policy', p(PERMISSIONS.MANAGE_SETTINGS, PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTLEMENTS), riderPayCtrl.getPolicy);
router.put('/rider-pay/policy', p(PERMISSIONS.MANAGE_SETTINGS), riderPayCtrl.updatePolicy);
router.get('/rider-pay/preview', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTINGS), riderPayCtrl.previewPay);
router.post('/rider-pay/settle', p(PERMISSIONS.MANAGE_SETTLEMENTS, PERMISSIONS.MANAGE_SETTINGS), riderPayCtrl.settle);
router.get('/rider-pay/periods', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTLEMENTS), riderPayCtrl.listPeriods);
router.get('/rider-pay/conditions', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_STORES), riderPayCtrl.listConditions);
router.put('/stores/:id/rider-conditions', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_STORES), riderPayCtrl.setConditions);
router.get('/delivery-partners/:id/pay-periods', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTLEMENTS), riderPayCtrl.riderPeriods);
router.post('/delivery-partners/:id/pay-periods/:kind/:key/withhold', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTLEMENTS), riderPayCtrl.withholdPeriod);
router.post('/delivery-partners/:id/pay-periods/:kind/:key/release', p(PERMISSIONS.MANAGE_SETTLEMENTS), riderPayCtrl.releasePeriod);
// Notices for partners / customers (Updates tab).
router.get('/announcements', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PROMOTIONS), announcementsCtrl.list);
router.post('/announcements', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PROMOTIONS), announcementRules, validate, announcementsCtrl.create);
router.get('/announcements/:id', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PROMOTIONS), announcementsCtrl.get);
router.put('/announcements/:id', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PROMOTIONS), announcementRules, validate, announcementsCtrl.update);
router.delete('/announcements/:id', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PROMOTIONS), announcementsCtrl.archive);
router.post('/announcements/:id/publish', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PROMOTIONS), announcementsCtrl.publish);
router.get('/announcements/:id/stats', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PROMOTIONS), announcementsCtrl.stats);
// Picker product-based pay: policy, earnings, errors; per-order contribution report.
router.get('/picker-pay/policy', p(PERMISSIONS.MANAGE_SETTINGS, PERMISSIONS.MANAGE_SETTLEMENTS), pickerPayCtrl.getPolicy);
router.put('/picker-pay/policy', p(PERMISSIONS.MANAGE_SETTINGS), pickerPayCtrl.updatePolicy);
router.post('/picker-pay/settle', p(PERMISSIONS.MANAGE_SETTLEMENTS, PERMISSIONS.MANAGE_SETTINGS), pickerPayCtrl.settle);
router.get('/pickers/:id/earnings', p(PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_SETTLEMENTS), pickerPayCtrl.pickerDay);
// Individual rates: everyone can be paid differently (default -> store -> person).
router.get('/pickers/:id/pay-policy', p(PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_SETTINGS), pickerPayCtrl.getPickerPolicy);
router.put('/pickers/:id/pay-policy', p(PERMISSIONS.MANAGE_SETTINGS), pickerPayCtrl.setPickerPolicy);
router.get('/stores/:id/picker-pay-policy', p(PERMISSIONS.MANAGE_STORES, PERMISSIONS.MANAGE_SETTINGS), pickerPayCtrl.getStorePolicy);
router.put('/stores/:id/picker-pay-policy', p(PERMISSIONS.MANAGE_SETTINGS), pickerPayCtrl.setStorePolicy);
router.get('/delivery-partners/:id/pay', p(PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_SETTINGS), riderPayCtrl.getRiderPay);
router.put('/delivery-partners/:id/pay', p(PERMISSIONS.MANAGE_SETTINGS), riderPayCtrl.setRiderPay);
router.get('/pickers/:id/earning-days', p(PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_SETTLEMENTS), pickerPayCtrl.pickerDays);
router.get('/picker-errors', p(PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), pickerPayCtrl.listErrors);
router.post('/picker-errors', p(PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), pickerPayCtrl.reportError);
router.patch('/picker-errors/:id', p(PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_ORDERS), pickerPayCtrl.reviewError);
router.get('/order-economics', p(PERMISSIONS.VIEW_REPORTS, PERMISSIONS.MANAGE_SETTINGS), pickerPayCtrl.getEconomics);
router.put('/order-economics', p(PERMISSIONS.MANAGE_SETTINGS), pickerPayCtrl.updateEconomics);
router.get('/reports/order-contribution', p(PERMISSIONS.VIEW_REPORTS), pickerPayCtrl.contribution);
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
router.delete('/stores/:id', p(PERMISSIONS.MANAGE_STORES), storesCtrl.deleteStore);

// Hub Center screens (/hub-display) — store managers manage their own store's screens only.
router.get('/stores/:id/hub-displays', p(PERMISSIONS.MANAGE_STORES, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), hubDisplaysCtrl.listHubDisplays);
router.post('/stores/:id/hub-displays', p(PERMISSIONS.MANAGE_STORES, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), hubDisplaysCtrl.createHubDisplay);
router.delete('/hub-displays/:id', p(PERMISSIONS.MANAGE_STORES, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), hubDisplaysCtrl.revokeHubDisplay);

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
// cancel orders for just their own store; picker/delivery assignment stays admin-only)
router.get('/orders', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.listOrders);
router.get('/orders/:id', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.getOrderDetail);
router.patch('/orders/:id/cancel', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.cancelOrder);
router.patch('/orders/:id/mark-returned', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ordersCtrl.markReturned);
router.patch('/orders/:id/assign-picker', p(PERMISSIONS.MANAGE_ORDERS), ordersCtrl.assignPicker);
router.patch('/orders/:id/assign-delivery', p(PERMISSIONS.MANAGE_ORDERS), ordersCtrl.assignDelivery);

// Live tracking: rider map + one order's rider position / ETA (store managers: own hub only)
router.get('/tracking/riders', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), trackingCtrl.listRiders);
// IVR: call log, Exotel webhook URLs, and calling a customer about an order on demand
router.get('/ivr/calls', p(PERMISSIONS.MANAGE_ORDERS), ivrCtrl.listCalls);
router.get('/ivr/config', p(PERMISSIONS.MANAGE_SETTINGS), ivrCtrl.getConfig);
router.post('/orders/:id/ivr-call', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), ivrCtrl.callCustomer);
// Masked customer <-> rider calls (in-app VoIP): call log and Twilio TwiML App URLs
router.get('/voip/calls', p(PERMISSIONS.MANAGE_ORDERS), voipCtrl.listCalls);
router.get('/voip/config', p(PERMISSIONS.MANAGE_SETTINGS), voipCtrl.getConfig);

// SOS alerts (services/sos.service.js) — store managers see their own store's only.
const SOS_PERMS = [PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PICKERS, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY];
router.get('/sos', p(...SOS_PERMS), sosCtrl.list);
router.get('/sos/:id', p(...SOS_PERMS), sosCtrl.get);
router.post('/sos/:id/acknowledge', p(...SOS_PERMS), sosCtrl.acknowledge);
router.post('/sos/:id/resolve', p(...SOS_PERMS), sosCtrl.resolve);
router.get('/orders/:id/tracking', p(PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_OWN_STORE_INVENTORY), trackingCtrl.getOrderTracking);
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

// Order charges (delivery / handling / packing / surcharge) — see services/charges.service.js
router.get('/charges', p(PERMISSIONS.MANAGE_SETTINGS), orderSettingsCtrl.getCharges);
router.put('/charges', p(PERMISSIONS.MANAGE_SETTINGS), orderSettingsCtrl.updateCharges);

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
router.get('/support-tickets/:id', p(PERMISSIONS.MANAGE_ORDERS), supportCtrl.getTicketAdmin);
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
