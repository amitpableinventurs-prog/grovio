const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/delivery/delivery.controller');
const hubCtrl = require('../controllers/delivery/hub.controller');
const onboardingCtrl = require('../controllers/delivery/onboarding.controller');
const voipCtrl = require('../controllers/voip/voip.controller');
const programsCtrl = require('../controllers/delivery/programs.controller');
const accountCtrl = require('../controllers/common/account.controller');
const upload = require('../middleware/upload.middleware');
const validate = require('../middleware/validate.middleware');
const { vehicleRules, identityRules, bankRules } = require('../validators/delivery.validator');

router.use(authenticate, authorize('delivery'));

// Account deletion (services/accountDeletion.service.js)
router.get('/account/delete-check', accountCtrl.deletionCheck);
router.delete('/account', accountCtrl.deleteAccount);

// Onboarding after OTP signup — one endpoint per app screen (see onboarding.controller.js).
router.get('/onboarding', onboardingCtrl.getOnboarding);
router.put('/onboarding/vehicle', vehicleRules, validate, onboardingCtrl.saveVehicle);
router.post('/onboarding/identity', upload.single('document'), identityRules, validate, onboardingCtrl.saveIdentity);
router.post(
  '/onboarding/address-proof',
  upload.fields([{ name: 'frontImage', maxCount: 1 }, { name: 'backImage', maxCount: 1 }]),
  onboardingCtrl.saveAddressProof
);
router.post('/onboarding/selfie', upload.single('selfie'), onboardingCtrl.saveSelfie);
router.post('/onboarding/bank', upload.single('document'), bankRules(), validate, onboardingCtrl.saveBankDetails);

router.patch('/availability', ctrl.toggleAvailability);
router.post('/location', ctrl.updateLocation);
router.get('/route', ctrl.getRoute);
router.get('/profile', ctrl.getProfile);
router.patch('/profile', ctrl.updateProfile);

// "New order request" cards — assigned to me, not yet accepted/rejected (also pushed as the
// 'delivery:request' socket event).
router.get('/requests', ctrl.listRequests);
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
// Masked in-app call to the customer (services/voip.service.js) — riders never get their number.
router.post('/jobs/:id/call', voipCtrl.callFromDelivery);

// At a Hub Center: check in by scanning the hub screen's QR, then pick an order to collect.
router.post('/hub/scan', hubCtrl.scan);
router.post('/hub/checkin', hubCtrl.checkIn);
router.get('/hub/orders', hubCtrl.listHubOrders);
router.post('/hub/orders/:id/claim', hubCtrl.claimOrder);
router.post('/hub/checkout', hubCtrl.checkOut);

router.get('/history', ctrl.listHistory);
router.get('/earnings', ctrl.getEarnings);

// Home feed: online state, gig in progress, today's progress, live offers.
router.get('/dashboard', programsCtrl.dashboard);

// Gigs — bookable shifts (services/gig.service.js).
router.get('/gigs', programsCtrl.listGigs);
router.post('/gigs/book', programsCtrl.bookGigs);
router.get('/gigs/current', programsCtrl.currentGig);
router.get('/gigs/history', programsCtrl.gigHistory);
router.get('/gigs/history/:bookingId', programsCtrl.gigHistoryDetail);
router.post('/gigs/:id/cancel', programsCtrl.cancelGig);

// Incentive offers (services/offer.service.js).
router.get('/offers', programsCtrl.listOffers);
router.get('/offers/weeks', programsCtrl.offerWeeks);
router.get('/offers/:id', programsCtrl.getOffer);
router.get('/offers/:id/conditions/:key', programsCtrl.offerCondition);

// Account on hold ("Face not matching") and selfie checks (services/accountHold.service.js).
router.get('/account-status', programsCtrl.accountStatus);
router.post('/selfie-checks', upload.single('selfie'), programsCtrl.submitSelfie);

// Cold bags for frozen items: scan one for the order before pickup, scan it back in at a store.
router.post('/jobs/:id/cold-bag', programsCtrl.scanColdBag);
router.get('/cold-bags', programsCtrl.myColdBags);
router.post('/cold-bags/return', programsCtrl.returnColdBag);

// "Collect ₹228 via UPI" at the door — payment goes straight to the company (services/collect.service.js).
router.get('/jobs/:id/collect', programsCtrl.collectInfo);
router.get('/jobs/:id/collect/status', programsCtrl.collectStatus);

// Home map: where to head now (hub / pickup / customer) with route and actions; the store card alone.
router.get('/map', programsCtrl.getMap);
router.get('/home-store', programsCtrl.getHomeStore);

// Pocket: balance, weekly statement, deductions, withdrawals / weekly payouts, cash deposit
// (services/pocket.service.js).
router.get('/pocket', programsCtrl.pocketSummary);
router.get('/pocket/statement', programsCtrl.pocketStatement);
router.get('/pocket/deductions', programsCtrl.pocketDeductions);
router.get('/pocket/weeks', programsCtrl.pocketWeeks);
router.post('/pocket/withdraw', programsCtrl.withdraw);
router.get('/pocket/transfers', programsCtrl.listTransfers);
router.get('/pocket/transfers/:id', programsCtrl.getTransfer);
router.post('/pocket/transfers/:id/dismiss', programsCtrl.dismissTransfer);
router.post('/pocket/deposit', programsCtrl.createDeposit);
router.post('/pocket/deposit/verify', programsCtrl.verifyDeposit);

// Earnings (day/week/month), login sessions and trip history (services/riderEarnings.service.js).
router.get('/earnings/summary', programsCtrl.earningsSummary);
router.get('/earnings/incentives', programsCtrl.incentives);
router.get('/sessions', programsCtrl.sessionHistory);
router.get('/trips', programsCtrl.tripHistory);
router.get('/trips/:id', programsCtrl.tripDetail);

module.exports = router;
