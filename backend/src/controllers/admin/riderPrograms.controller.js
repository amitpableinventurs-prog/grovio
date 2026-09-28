const { GigSlot, GigBooking, IncentiveOffer, User, Order } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const t = require('../../utils/localTime');
const { logAdminActivity } = require('../../services/audit.service');
const { notifyUser } = require('../../services/notification.service');
const offers = require('../../services/offer.service');
const pocket = require('../../services/pocket.service');
const holds = require('../../services/accountHold.service');
const coldBags = require('../../services/coldBag.service');
const { AccountHold, SelfieCheck, DeliveryProfile } = require('../../models');

// Admin: delivery partner gigs, incentive offers and extra earnings (the data behind the delivery
// app's Gigs, Offers and Earnings screens).

// ---- Gigs -----------------------------------------------------------------------------------

// GET /admin/gigs?date=YYYY-MM-DD&days=1..14&storeId=&status=
// Gigs from `date` for `days` days, plus a per-day summary (for a week strip).
const listGigs = catchAsync(async (req, res) => {
  const day = t.dayFromQuery(req.query.date);
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 1, 1), 14);
  const where = { startAt: { $gte: day, $lt: t.addDays(day, days) } };
  if (req.query.storeId) where.store = req.query.storeId === 'none' ? null : req.query.storeId;
  if (req.query.status) where.status = req.query.status;
  const items = await GigSlot.find(where).populate('store', 'name').sort({ startAt: 1 });
  const summary = Array.from({ length: days }, (_, i) => {
    const d = t.addDays(day, i);
    const onDay = items.filter((g) => t.dateKey(g.startAt) === t.dateKey(d) && g.status === 'active');
    return {
      date: t.dateKey(d),
      label: t.dayLabel(d),
      weekday: t.weekdayLabel(d),
      gigs: onDay.length,
      booked: onDay.reduce((s, g) => s + g.bookedCount, 0),
      seats: onDay.some((g) => g.capacity === null) ? null : onDay.reduce((s, g) => s + g.capacity, 0),
    };
  });
  new ApiResponse(200, { date: t.dateKey(day), days, summary, items }).send(res);
});

// POST /admin/gigs/bulk { storeId?, dates: ['2026-09-27'], slots: [{ from: '11:00', to: '12:00', ... }] }
// Creates each slot on each date; an identical active gig already there is skipped.
const bulkCreateGigs = catchAsync(async (req, res) => {
  const { storeId = null, dates, slots } = req.body;
  const created = [];
  let skipped = 0;
  for (const key of dates) {
    const day = t.parseDateKey(key);
    if (!day) throw new ApiError(422, `Invalid date ${key}`);
    for (const s of slots) {
      const startAt = t.atTime(day, s.from);
      let endAt = t.atTime(day, s.to);
      if (endAt <= startAt) endAt = t.addDays(endAt, 1); // e.g. 23:00 - 00:00
      const minLogin = s.minLoginMinutes ?? 50;
      if (minLogin > (endAt - startAt) / 60000) throw new ApiError(422, `minLoginMinutes (${minLogin}) is longer than the ${s.from}-${s.to} gig`);
      if (await GigSlot.exists({ store: storeId, startAt, endAt, status: 'active' })) { skipped += 1; continue; }
      created.push(await GigSlot.create({
        store: storeId,
        startAt,
        endAt,
        payPerHourMin: s.payPerHourMin ?? null,
        payPerHourMax: s.payPerHourMax ?? s.payPerHourMin ?? null,
        capacity: s.capacity ?? null,
        minLoginMinutes: minLogin,
        isFree: !!s.isFree,
        isPriority: !!s.isPriority,
        note: s.note || null,
        createdBy: req.user.id,
      }));
    }
  }
  await logAdminActivity({ adminId: req.user.id, action: 'gigs.create', entityType: 'GigSlot', metadata: { created: created.length, skipped, dates } });
  new ApiResponse(201, { created: created.length, skipped, items: created }, `${created.length} gigs created`).send(res);
});

// PATCH /admin/gigs/:id
const updateGig = catchAsync(async (req, res) => {
  const slot = await GigSlot.findById(req.params.id);
  if (!slot) throw new ApiError(404, 'Gig not found');
  if (slot.status === 'cancelled') throw new ApiError(400, 'This gig was cancelled');
  for (const key of ['payPerHourMin', 'payPerHourMax', 'capacity', 'minLoginMinutes', 'isFree', 'isPriority', 'note']) {
    if (req.body[key] !== undefined) slot[key] = req.body[key];
  }
  if (slot.capacity !== null && slot.capacity < slot.bookedCount) throw new ApiError(400, `${slot.bookedCount} partners have already booked this gig`);
  await slot.save();
  new ApiResponse(200, slot, 'Gig updated').send(res);
});

// DELETE /admin/gigs/:id -> cancels the gig and every booking on it (partners are notified)
const cancelGig = catchAsync(async (req, res) => {
  const slot = await GigSlot.findById(req.params.id);
  if (!slot) throw new ApiError(404, 'Gig not found');
  if (slot.status === 'cancelled') throw new ApiError(400, 'This gig is already cancelled');
  if (slot.endAt <= new Date()) throw new ApiError(400, 'This gig has already ended');
  slot.status = 'cancelled';
  slot.bookedCount = 0;
  await slot.save();

  const bookings = await GigBooking.find({ slot: slot._id, status: 'booked' });
  await GigBooking.updateMany({ slot: slot._id, status: 'booked' }, { $set: { status: 'cancelled', cancelledAt: new Date() } });
  const when = `${t.dayLabel(slot.startAt)}, ${t.timeLabel(slot.startAt)} - ${t.timeLabel(slot.endAt)}`;
  await Promise.all(bookings.map((b) => notifyUser(b.rider, {
    title: 'Gig cancelled',
    body: `Your gig on ${when} was cancelled. Book another gig to keep earning.`,
    type: 'gig_cancelled',
    data: { gigId: slot._id },
  }).catch(() => {})));

  await logAdminActivity({ adminId: req.user.id, action: 'gigs.cancel', entityType: 'GigSlot', entityId: slot._id, metadata: { bookings: bookings.length } });
  new ApiResponse(200, slot, `Gig cancelled${bookings.length ? `; ${bookings.length} partners notified` : ''}`).send(res);
});

// GET /admin/gigs/:id/bookings
const gigBookings = catchAsync(async (req, res) => {
  // Ended gigs show Completed / Incomplete right away, not after the background job.
  await require('../../services/gig.service').finalizeDue();
  const items = await GigBooking.find({ slot: req.params.id }).populate('rider', 'name phone').sort({ createdAt: 1 });
  new ApiResponse(200, items).send(res);
});

// PATCH /admin/gig-bookings/:id/exempt { exempted: true, reason } -> an incomplete gig stops
// counting against offer conditions (e.g. the app or a hub was down)
const exemptBooking = catchAsync(async (req, res) => {
  const booking = await GigBooking.findById(req.params.id);
  if (!booking) throw new ApiError(404, 'Booking not found');
  booking.exempted = req.body.exempted !== false;
  booking.exemptReason = booking.exempted ? (req.body.reason || 'Exempted by admin') : null;
  await booking.save();
  await logAdminActivity({ adminId: req.user.id, action: 'gigs.exempt', entityType: 'GigBooking', entityId: booking._id, metadata: { exempted: booking.exempted, reason: booking.exemptReason } });
  new ApiResponse(200, booking, booking.exempted ? 'Gig exempted' : 'Exemption removed').send(res);
});

// ---- Offers ---------------------------------------------------------------------------------

const OFFER_FIELDS = ['title', 'description', 'startAt', 'endAt', 'riders', 'tiers', 'conditions', 'conditionAudio', 'compulsoryLogin', 'videoUrl'];
const pick = (src) => Object.fromEntries(OFFER_FIELDS.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));

async function checkRiders(ids = []) {
  if (!ids.length) return;
  const count = await User.countDocuments({ _id: { $in: ids }, role: 'delivery' });
  if (count !== new Set(ids.map(String)).size) throw new ApiError(422, 'riders must all be delivery partners');
}

const adminView = (offer) => ({ ...offer.toObject(), ...offers.baseView(offer, new Date()) });

// GET /admin/offers?status=live|upcoming|expired|cancelled
const listOffers = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const now = new Date();
  const where = {};
  switch (req.query.status) {
    case 'live': Object.assign(where, { status: 'active', startAt: { $lte: now }, endAt: { $gt: now } }); break;
    case 'upcoming': Object.assign(where, { status: 'active', startAt: { $gt: now } }); break;
    case 'expired': Object.assign(where, { status: 'active', endAt: { $lte: now } }); break;
    case 'cancelled': where.status = 'cancelled'; break;
    default: break;
  }
  const [rows, count] = await Promise.all([
    IncentiveOffer.find(where).sort({ startAt: -1 }).skip(offset).limit(limit),
    IncentiveOffer.countDocuments(where),
  ]);
  new ApiResponse(200, { items: rows.map(adminView), meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const createOffer = catchAsync(async (req, res) => {
  const data = pick(req.body);
  await checkRiders(data.riders);
  const offer = await IncentiveOffer.create({ ...data, createdBy: req.user.id });
  await logAdminActivity({ adminId: req.user.id, action: 'offers.create', entityType: 'IncentiveOffer', entityId: offer._id });
  new ApiResponse(201, adminView(offer), 'Offer created').send(res);
});

const getOffer = catchAsync(async (req, res) => {
  const offer = await IncentiveOffer.findById(req.params.id).populate('riders', 'name phone');
  if (!offer) throw new ApiError(404, 'Offer not found');
  new ApiResponse(200, adminView(offer)).send(res);
});

// PUT /admin/offers/:id — not once it has been paid out.
const updateOffer = catchAsync(async (req, res) => {
  const offer = await IncentiveOffer.findById(req.params.id);
  if (!offer) throw new ApiError(404, 'Offer not found');
  if (offer.settledAt) throw new ApiError(400, 'This offer has already been paid out');
  if (offer.status === 'cancelled') throw new ApiError(400, 'This offer was cancelled');
  const data = pick(req.body);
  await checkRiders(data.riders);
  offer.set(data);
  await offer.save();
  await logAdminActivity({ adminId: req.user.id, action: 'offers.update', entityType: 'IncentiveOffer', entityId: offer._id });
  new ApiResponse(200, adminView(offer), 'Offer updated').send(res);
});

// DELETE /admin/offers/:id -> cancels it (nobody is paid)
const cancelOffer = catchAsync(async (req, res) => {
  const offer = await IncentiveOffer.findById(req.params.id);
  if (!offer) throw new ApiError(404, 'Offer not found');
  if (offer.settledAt) throw new ApiError(400, 'This offer has already been paid out');
  offer.status = 'cancelled';
  await offer.save();
  await logAdminActivity({ adminId: req.user.id, action: 'offers.cancel', entityType: 'IncentiveOffer', entityId: offer._id });
  new ApiResponse(200, adminView(offer), 'Offer cancelled').send(res);
});

// GET /admin/offers/:id/riders -> each partner's progress (live) or payout (settled)
const offerRiders = catchAsync(async (req, res) => {
  const offer = await IncentiveOffer.findById(req.params.id);
  if (!offer) throw new ApiError(404, 'Offer not found');
  new ApiResponse(200, await offers.ridersProgress(offer)).send(res);
});

// POST /admin/offers/:id/settle -> pay out now instead of waiting for the background job
const settleOffer = catchAsync(async (req, res) => {
  const offer = await IncentiveOffer.findById(req.params.id);
  if (!offer) throw new ApiError(404, 'Offer not found');
  const result = await offers.settleOffer(offer);
  await logAdminActivity({ adminId: req.user.id, action: 'offers.settle', entityType: 'IncentiveOffer', entityId: offer._id, metadata: result });
  new ApiResponse(200, result, `Paid ${result.paid} partners ₹${result.total}`).send(res);
});

// ---- Other earnings -------------------------------------------------------------------------

async function findRider(id) {
  const rider = await User.findOne({ _id: id, role: 'delivery' }).select('name');
  if (!rider) throw new ApiError(404, 'Delivery partner not found');
  return rider;
}
async function checkRiderOrder(riderId, orderId) {
  if (orderId && !(await Order.exists({ _id: orderId, delivery: riderId }))) throw new ApiError(422, 'That order was not delivered by this partner');
}

// POST /admin/delivery-partners/:id/earnings { amount, reason, orderId? } -> "Other earnings"
// credit. With orderId it also shows as a pay line in that trip's details (e.g. "Long Distance
// Return Pay" after a support ticket).
const addEarning = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const { amount, reason, orderId = null } = req.body;
  await checkRiderOrder(rider._id, orderId);
  const txn = await pocket.post({ userId: rider._id, type: 'credit', amount, category: 'other_earning', reason, title: reason, refOrderId: orderId });
  await logAdminActivity({ adminId: req.user.id, action: 'delivery.earning', entityType: 'User', entityId: rider._id, metadata: { amount, reason, orderId } });
  await notifyUser(rider._id, { title: 'Earning added', body: `₹${amount} added: ${reason}`, type: 'earning' }).catch(() => {});
  new ApiResponse(201, { balance: txn.balanceAfter, transaction: txn }, 'Earning added').send(res);
});

// POST /admin/delivery-partners/:id/deductions { amount, title, description?, orderId? }
// -> Deduction statement entry ("Temp Manual Pay — Cold Bag Fraud 27th Jan"); can take the pocket negative.
const addDeduction = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const { amount, title, description = null, orderId = null } = req.body;
  await checkRiderOrder(rider._id, orderId);
  const txn = await pocket.addDeduction(rider._id, { amount, title, description, orderId });
  await logAdminActivity({ adminId: req.user.id, action: 'delivery.deduction', entityType: 'User', entityId: rider._id, metadata: { amount, title, description, orderId } });
  new ApiResponse(201, { balance: txn.balanceAfter, transaction: txn }, 'Deduction added').send(res);
});

// POST /admin/delivery-partners/:id/cash-deposits { amount, reference? } -> COD cash handed in at the hub
const recordCashDeposit = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const transfer = await pocket.recordHubDeposit(rider._id, req.body.amount, req.body.reference, req.user.id);
  await logAdminActivity({ adminId: req.user.id, action: 'delivery.cash_deposit', entityType: 'User', entityId: rider._id, metadata: { amount: req.body.amount, reference: req.body.reference } });
  new ApiResponse(201, transfer, 'Cash deposit recorded').send(res);
});

// GET /admin/pocket-transfers?status=&type=&riderId= -> withdrawals / weekly payouts / deposits to process
const listPocketTransfers = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { items, count } = await pocket.adminListTransfers(req.query, { offset, limit });
  new ApiResponse(200, { items, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// PATCH /admin/pocket-transfers/:id { status: in_process|completed|failed, reference?, failureReason? }
// A failed withdrawal/payout goes back into the partner's pocket.
const updatePocketTransfer = catchAsync(async (req, res) => {
  const view = await pocket.updateTransfer(req.params.id, req.body, req.user.id);
  await logAdminActivity({ adminId: req.user.id, action: 'pocket.transfer', entityType: 'PocketTransfer', entityId: req.params.id, metadata: req.body });
  new ApiResponse(200, view, `Marked ${view.statusLabel.toLowerCase()}`).send(res);
});

// POST /admin/pocket-transfers/weekly-payouts -> start this week's payouts now (otherwise the
// background job does it on Monday morning)
const runWeeklyPayouts = catchAsync(async (req, res) => {
  const result = await pocket.runWeeklyPayouts({ force: true });
  await logAdminActivity({ adminId: req.user.id, action: 'pocket.weekly_payouts', metadata: result });
  new ApiResponse(200, result, `${result.created} weekly payouts initiated`).send(res);
});

// ---- Account holds ------------------------------------------------------------------------

// POST /admin/delivery-partners/:id/hold { reason, title?, details?, durationHours? (blank = until unlocked) }
const holdAccount = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const { reason = 'other', title, details, durationHours } = req.body;
  const hold = await holds.placeHold(rider._id, { reason, title, details, durationHours: durationHours ? Number(durationHours) : null, createdBy: req.user.id });
  await logAdminActivity({ adminId: req.user.id, action: 'delivery.hold', entityType: 'User', entityId: rider._id, metadata: { reason, durationHours } });
  new ApiResponse(201, hold, 'Account put on hold').send(res);
});

// POST /admin/delivery-partners/:id/unhold { note? } -> unlock now
const unholdAccount = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const hold = await holds.releaseHold(rider._id, { type: 'manual', by: req.user.id, note: req.body?.note || null });
  if (!hold) throw new ApiError(400, 'This account is not on hold');
  await logAdminActivity({ adminId: req.user.id, action: 'delivery.unhold', entityType: 'User', entityId: rider._id, metadata: { note: req.body?.note } });
  new ApiResponse(200, hold, 'Account unlocked').send(res);
});

// GET /admin/delivery-partners/:id/holds -> hold cases, newest first
const listHolds = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const [items, profile] = await Promise.all([
    AccountHold.find({ rider: rider._id }).populate('createdBy', 'name').populate('releasedBy', 'name').sort({ createdAt: -1 }),
    DeliveryProfile.findOne({ user: rider._id }).select('hold'),
  ]);
  new ApiResponse(200, { current: profile?.hold || null, items }).send(res);
});

// GET /admin/selfie-checks?status=pending -> with the partner's onboarding selfie to compare
const listSelfieChecks = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = { status: req.query.status || 'pending' };
  const [rows, count] = await Promise.all([
    SelfieCheck.find(where).populate('rider', 'name phone').sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    SelfieCheck.countDocuments(where),
  ]);
  const profiles = await DeliveryProfile.find({ user: { $in: rows.map((r) => r.rider?._id) } }).select('user selfie').lean();
  const selfies = new Map(profiles.map((p) => [String(p.user), p.selfie?.image || null]));
  const items = rows.map((r) => ({ ...r, profileSelfie: selfies.get(String(r.rider?._id)) || null }));
  new ApiResponse(200, { items, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// PATCH /admin/selfie-checks/:id { result: 'match' | 'mismatch' } -> mismatch holds the account
const reviewSelfieCheck = catchAsync(async (req, res) => {
  const check = await holds.reviewSelfie(req.params.id, { result: req.body.result, adminId: req.user.id });
  await logAdminActivity({ adminId: req.user.id, action: 'delivery.selfie_review', entityType: 'SelfieCheck', entityId: check._id, metadata: { result: check.status } });
  new ApiResponse(200, check, check.status === 'mismatch' ? 'Marked mismatch — account on hold' : 'Marked match').send(res);
});

// ---- Cold bags --------------------------------------------------------------------------------

// POST /admin/cold-bags { storeId, count, prefix? } -> new bags with QR labels to print
const createColdBags = catchAsync(async (req, res) => {
  const bags = await coldBags.createBags(req.body.storeId, req.body.count, req.body.prefix);
  await logAdminActivity({ adminId: req.user.id, action: 'cold_bags.create', entityType: 'Store', entityId: req.body.storeId, metadata: { count: bags.length } });
  new ApiResponse(201, bags, `${bags.length} cold bags created`).send(res);
});
const listColdBags = catchAsync(async (req, res) => new ApiResponse(200, await coldBags.listBags(req.query)).send(res));
const overdueColdBags = catchAsync(async (req, res) => new ApiResponse(200, await coldBags.overdueIssues()).send(res));
// PATCH /admin/cold-bag-issues/:id/lost { amount?, title?, description? }
const markColdBagLost = catchAsync(async (req, res) => {
  const issue = await coldBags.markLost(req.params.id, req.body || {});
  await logAdminActivity({ adminId: req.user.id, action: 'cold_bags.lost', entityType: 'ColdBagIssue', entityId: issue._id, metadata: req.body });
  new ApiResponse(200, issue, issue.penaltyTxn ? 'Marked lost and deducted' : 'Marked lost').send(res);
});

module.exports = {
  holdAccount,
  unholdAccount,
  listHolds,
  listSelfieChecks,
  reviewSelfieCheck,
  createColdBags,
  listColdBags,
  overdueColdBags,
  markColdBagLost,
  listGigs,
  bulkCreateGigs,
  updateGig,
  cancelGig,
  gigBookings,
  exemptBooking,
  listOffers,
  createOffer,
  getOffer,
  updateOffer,
  cancelOffer,
  offerRiders,
  settleOffer,
  addEarning,
  addDeduction,
  recordCashDeposit,
  listPocketTransfers,
  updatePocketTransfer,
  runWeeklyPayouts,
};
