const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/delivery/delivery.controller');
const hubCtrl = require('../controllers/delivery/hub.controller');

router.use(authenticate, authorize('delivery'));

router.patch('/availability', ctrl.toggleAvailability);
router.post('/location', ctrl.updateLocation);
router.get('/profile', ctrl.getProfile);
router.patch('/profile', ctrl.updateProfile);

router.get('/jobs', ctrl.listJobs);
router.get('/jobs/:id', ctrl.getJobDetail);
router.post('/jobs/:id/accept', ctrl.acceptJob);
router.post('/jobs/:id/reject', ctrl.rejectAssignment);
router.post('/jobs/:id/arrived-pickup', ctrl.markArrivedAtPickup);
router.get('/jobs/:id/pickers', ctrl.listAssignedPickers);
router.post('/jobs/:id/otp/verify', ctrl.verifyHandoverOtpCtrl);
router.post('/jobs/:id/scan', ctrl.scanHandoverQr);
router.post('/jobs/:id/out-for-delivery', ctrl.markOutForDelivery);
router.post('/jobs/:id/arrived-drop', ctrl.markArrivedAtDrop);
router.post('/jobs/:id/complete', ctrl.completeJob);
router.post('/jobs/:id/failed', ctrl.markFailed);
router.post('/jobs/:id/return', ctrl.markReturned);

// At a Hub Center: check in by scanning the hub screen's QR, then pick an order to collect.
router.post('/hub/checkin', hubCtrl.checkIn);
router.get('/hub/orders', hubCtrl.listHubOrders);
router.post('/hub/orders/:id/claim', hubCtrl.claimOrder);
router.post('/hub/checkout', hubCtrl.checkOut);

router.get('/history', ctrl.listHistory);
router.get('/earnings', ctrl.getEarnings);

module.exports = router;
