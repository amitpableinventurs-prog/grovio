const { DeliveryProfile } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const gigs = require('../../services/gig.service');
const offers = require('../../services/offer.service');
const earnings = require('../../services/riderEarnings.service');
const sessions = require('../../services/riderSession.service');
const pocket = require('../../services/pocket.service');
const { mapState, homeStore } = require('../../services/riderMap.service');
const holds = require('../../services/accountHold.service');
const coldBags = require('../../services/coldBag.service');
const collect = require('../../services/collect.service');


// Delivery app: home feed, gigs, offers, earnings, sessions and trips.

// GET /delivery/dashboard -> the Feed screen: online state, current gig, today's progress, live offers
const dashboard = catchAsync(async (req, res) => {
  const [profile, gig, today, liveOffers, store, map, alerts, account, bags, notices] = await Promise.all([
    DeliveryProfile.findOne({ user: req.user.id }).select('isAvailable status'),
    gigs.currentGig(req.user.id),
    earnings.todayProgress(req.user.id),
    offers.liveForRider(req.user.id),
    homeStore(req.user.id, req.query),
    mapState(req.user.id, req.query),
    pocket.failedTransferAlerts(req.user.id),
    holds.accountStatus(req.user.id),
    coldBags.myBags(req.user.id),
    require('../../services/announcement.service').unreadCount(req.user),
  ]);
  if (!profile) throw new ApiError(404, 'Delivery profile not found');
  new ApiResponse(200, {
    online: profile.isAvailable,
    accountStatus: profile.status,
    gig: gig.gig,
    nextGig: gig.nextGig,
    today,
    offers: liveOffers,
    store,
    // "Account on hold" screen when account.onHold (GET /delivery/account-status).
    account,
    // Cold bags still to be returned to a store.
    coldBags: bags,
    // Updates tab badge: unread notices / ones to confirm.
    notices,
    // Home map: where to head now (store / pickup / customer), route and actions — same as GET /delivery/map.
    map,
    // Popups to show once, e.g. "Failed to transfer amount" (dismiss: POST /delivery/pocket/transfers/:id/dismiss).
    alerts,
  }).send(res);
});

// ---- Gigs -----------------------------------------------------------------------------------

// GET /delivery/gigs?date=YYYY-MM-DD&filter=all|open|booked&storeId=
const listGigs = catchAsync(async (req, res) => {
  new ApiResponse(200, await gigs.listGigs(req.user.id, req.query)).send(res);
});

// POST /delivery/gigs/book { gigIds: [] }
const bookGigs = catchAsync(async (req, res) => {
  const result = await gigs.bookGigs(req.user.id, req.body.gigIds);
  const msg = `${result.booked.length} gig${result.booked.length === 1 ? '' : 's'} booked${result.failed.length ? `, ${result.failed.length} could not be booked` : ''}`;
  new ApiResponse(201, result, msg).send(res);
});

// POST /delivery/gigs/:id/cancel
const cancelGig = catchAsync(async (req, res) => {
  new ApiResponse(200, await gigs.cancelBooking(req.user.id, req.params.id), 'Gig booking cancelled').send(res);
});

// GET /delivery/gigs/current
const currentGig = catchAsync(async (req, res) => {
  new ApiResponse(200, await gigs.currentGig(req.user.id)).send(res);
});

// GET /delivery/gigs/history?from=&to=
const gigHistory = catchAsync(async (req, res) => {
  new ApiResponse(200, await gigs.history(req.user.id, req.query)).send(res);
});

// GET /delivery/gigs/history/:bookingId
const gigHistoryDetail = catchAsync(async (req, res) => {
  new ApiResponse(200, await gigs.historyDetail(req.user.id, req.params.bookingId)).send(res);
});

// ---- Offers ---------------------------------------------------------------------------------

// GET /delivery/offers?week=this|next|YYYY-MM-DD
const listOffers = catchAsync(async (req, res) => {
  new ApiResponse(200, await offers.listForRider(req.user.id, req.query)).send(res);
});

// GET /delivery/offers/weeks
const offerWeeks = catchAsync(async (req, res) => {
  new ApiResponse(200, await offers.weeksForRider(req.user.id)).send(res);
});

// GET /delivery/offers/:id
const getOffer = catchAsync(async (req, res) => {
  new ApiResponse(200, await offers.detailForRider(req.user.id, req.params.id)).send(res);
});

// GET /delivery/offers/:id/conditions/:key (orderDenials | cancellations | incompleteGigs)
const offerCondition = catchAsync(async (req, res) => {
  new ApiResponse(200, await offers.conditionDetail(req.user.id, req.params.id, req.params.key)).send(res);
});

// GET /delivery/map?lat=&lng= -> home map state: heading to the store, the pickup or the customer
const getMap = catchAsync(async (req, res) => {
  new ApiResponse(200, await mapState(req.user.id, req.query)).send(res);
});

// GET /delivery/home-store?lat=&lng=
const getHomeStore = catchAsync(async (req, res) => {
  new ApiResponse(200, await homeStore(req.user.id, req.query)).send(res);
});

// ---- Account hold, selfie checks ------------------------------------------------------------

// GET /delivery/account-status -> "Account on hold — Face not matching", "View last case"
const accountStatus = catchAsync(async (req, res) => new ApiResponse(200, await holds.accountStatus(req.user.id)).send(res));

// POST /delivery/selfie-checks (multipart: selfie) -> reviewed against the onboarding selfie
const submitSelfie = catchAsync(async (req, res) => {
  if (!req.file) throw new ApiError(422, 'Validation failed', [{ field: 'selfie', message: 'Take a selfie to continue' }]);
  const check = await holds.submitSelfie(req.user.id, `/uploads/${req.file.filename}`);
  new ApiResponse(201, { id: check._id, status: check.status, createdAt: check.createdAt }, 'Selfie submitted').send(res);
});

// ---- Cold bags ------------------------------------------------------------------------------

// POST /delivery/jobs/:id/cold-bag { code } -> scan a cold bag for a frozen-items order before pickup
const scanColdBag = catchAsync(async (req, res) => {
  new ApiResponse(200, await coldBags.scanForOrder(req.user.id, req.params.id, req.body.code), 'Cold bag linked to the order').send(res);
});
const myColdBags = catchAsync(async (req, res) => new ApiResponse(200, await coldBags.myBags(req.user.id)).send(res));
// POST /delivery/cold-bags/return { code, lat?, lng? } -> scan it back in at a store
const returnColdBag = catchAsync(async (req, res) => {
  const result = await coldBags.returnBag(req.user.id, req.body);
  new ApiResponse(200, result, result.message).send(res);
});

// ---- Collect payment at the door -------------------------------------------------------------

// GET /delivery/jobs/:id/collect -> "Collect ₹228 via UPI" QR
const collectInfo = catchAsync(async (req, res) => new ApiResponse(200, await collect.collectInfo(req.user.id, req.params.id)).send(res));
// GET /delivery/jobs/:id/collect/status -> { paid }
const collectStatus = catchAsync(async (req, res) => new ApiResponse(200, await collect.collectStatus(req.user.id, req.params.id)).send(res));

// ---- Pocket ---------------------------------------------------------------------------------

const pocketSummary = catchAsync(async (req, res) => new ApiResponse(200, await pocket.summary(req.user.id)).send(res));
const pocketStatement = catchAsync(async (req, res) => new ApiResponse(200, await pocket.statement(req.user.id, req.query)).send(res));
const pocketDeductions = catchAsync(async (req, res) => new ApiResponse(200, await pocket.deductions(req.user.id, req.query)).send(res));
const pocketWeeks = catchAsync(async (req, res) => new ApiResponse(200, pocket.weekOptions()).send(res));
const withdraw = catchAsync(async (req, res) => {
  new ApiResponse(201, await pocket.requestWithdrawal(req.user.id, req.body.amount), 'Withdrawal initiated').send(res);
});
const listTransfers = catchAsync(async (req, res) => new ApiResponse(200, await pocket.listTransfers(req.user.id, req.query)).send(res));
const getTransfer = catchAsync(async (req, res) => new ApiResponse(200, await pocket.getTransfer(req.user.id, req.params.id)).send(res));
const dismissTransfer = catchAsync(async (req, res) => new ApiResponse(200, await pocket.dismissFailure(req.user.id, req.params.id)).send(res));
const createDeposit = catchAsync(async (req, res) => {
  new ApiResponse(201, await pocket.createDeposit(req.user.id, req.body.amount), 'Complete the payment in Razorpay checkout').send(res);
});
const verifyDeposit = catchAsync(async (req, res) => {
  new ApiResponse(200, await pocket.verifyDeposit(req.user.id, req.body), 'Cash deposit received').send(res);
});

// ---- Earnings, sessions, trips --------------------------------------------------------------

// GET /delivery/earnings/summary?period=day|week|month&date=
const earningsSummary = catchAsync(async (req, res) => {
  new ApiResponse(200, await earnings.earningsSummary(req.user.id, req.query)).send(res);
});

// GET /delivery/earnings/incentives?date= -> daily slab / tier, weekly progress, guarantee, rate card
const incentives = catchAsync(async (req, res) => {
  new ApiResponse(200, await require('../../services/riderPay.service').incentivesForRider(req.user.id, req.query.date)).send(res);
});

// GET /delivery/sessions?date=&from=HH:mm&to=HH:mm
const sessionHistory = catchAsync(async (req, res) => {
  new ApiResponse(200, await sessions.sessionHistory(req.user.id, req.query)).send(res);
});

// GET /delivery/trips?period=day|week|month&date=&type=all|delivered|failed|returned
const tripHistory = catchAsync(async (req, res) => {
  new ApiResponse(200, await earnings.tripHistory(req.user.id, req.query)).send(res);
});

// GET /delivery/trips/:id
const tripDetail = catchAsync(async (req, res) => {
  const trip = await earnings.tripDetail(req.user.id, req.params.id);
  if (!trip) throw new ApiError(404, 'Trip not found');
  new ApiResponse(200, trip).send(res);
});

module.exports = {
  dashboard,
  listGigs,
  bookGigs,
  cancelGig,
  currentGig,
  gigHistory,
  gigHistoryDetail,
  listOffers,
  offerWeeks,
  getOffer,
  offerCondition,
  getHomeStore,
  getMap,
  accountStatus,
  submitSelfie,
  scanColdBag,
  myColdBags,
  returnColdBag,
  collectInfo,
  collectStatus,
  pocketSummary,
  pocketStatement,
  pocketDeductions,
  pocketWeeks,
  withdraw,
  listTransfers,
  getTransfer,
  dismissTransfer,
  createDeposit,
  verifyDeposit,
  earningsSummary,
  incentives,
  sessionHistory,
  tripHistory,
  tripDetail,
};
