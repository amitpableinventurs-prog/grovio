const crypto = require('crypto');
const QRCode = require('qrcode');
const { ColdBag, ColdBagIssue, Order, Product, DeliveryProfile, Store } = require('../models');
const ApiError = require('../utils/apiError');
const { distanceKm } = require('../utils/geo');
const t = require('../utils/localTime');
const { getSetting } = require('./settings.service');

// Cold bags for frozen items. An order with any requiresColdBag product (ice cream, meat, frozen
// snacks…) can only be picked up once the delivery partner has scanned a cold bag's QR for it;
// after delivering they scan the bag back in at a store. A bag not returned in time shows up as
// overdue for the admin, who can mark it lost and deduct from the partner's pocket ("Cold Bag Fraud").

async function returnHours() {
  const h = Number(await getSetting('coldBagReturnHours', 'COLD_BAG_RETURN_HOURS'));
  return Number.isFinite(h) && h > 0 ? h : 4;
}

// On assignment: does this order need a cold bag?
async function markNeedsColdBag(order) {
  if (order.needsColdBag) return true;
  const ids = (order.items || []).map((i) => i.product).filter(Boolean);
  if (!ids.length || !(await Product.exists({ _id: { $in: ids }, requiresColdBag: true }))) return false;
  await Order.updateOne({ _id: order._id }, { $set: { needsColdBag: true } });
  order.needsColdBag = true;
  return true;
}

// Before pickup (handover OTP / QR): a cold-bag order must have its bag scanned.
function requireForHandover(order) {
  if (order.needsColdBag && !order.coldBag) {
    throw new ApiError(400, 'This order has frozen items. Take a cold bag and scan its QR before pickup.');
  }
}

const bagView = (issue, bag) => {
  const now = new Date();
  return {
    issueId: issue._id,
    code: bag?.code,
    label: bag?.label || null,
    orders: (issue.orders || []).map((o) => (o.orderNumber ? { orderId: o._id, orderNumber: o.orderNumber, orderStatus: o.orderStatus } : { orderId: o })),
    issuedAt: issue.issuedAt,
    dueAt: issue.dueAt,
    dueLabel: `Return by ${t.timeLabel(issue.dueAt)}${t.dateKey(issue.dueAt) !== t.dateKey(now) ? `, ${t.dayLabel(issue.dueAt)}` : ''}`,
    overdue: issue.status === 'issued' && issue.dueAt < now,
    status: issue.status,
  };
};

// POST /delivery/jobs/:id/cold-bag { code } — scan the bag at pickup. One bag can carry several
// orders of the same run.
async function scanForOrder(riderId, orderId, code) {
  const order = await Order.findOne({ _id: orderId, delivery: riderId }).select('orderNumber orderStatus store needsColdBag coldBag items');
  if (!order) throw new ApiError(404, 'Order not found or not assigned to you');
  if (!order.needsColdBag && !(await markNeedsColdBag(order))) throw new ApiError(400, 'This order has no frozen items — no cold bag needed');
  if (order.orderStatus !== 'assigned') throw new ApiError(400, 'Scan the cold bag at the store, before pickup');

  const bag = await ColdBag.findOne({ code: String(code || '').trim().toUpperCase() });
  if (!bag) throw new ApiError(404, 'Cold bag not found. Scan the QR on the bag.');
  if (['lost', 'retired'].includes(bag.status)) throw new ApiError(400, 'This cold bag is out of service. Take another one.');

  let issue;
  if (bag.status === 'issued') {
    if (String(bag.issuedTo) !== String(riderId)) throw new ApiError(409, 'This cold bag is with another delivery partner');
    issue = await ColdBagIssue.findByIdAndUpdate(bag.currentIssue, { $addToSet: { orders: order._id } }, { new: true });
  } else {
    if (String(bag.store) !== String(order.store)) throw new ApiError(400, 'This cold bag belongs to another store');
    const now = new Date();
    issue = await ColdBagIssue.create({ bag: bag._id, rider: riderId, store: order.store, orders: [order._id], issuedAt: now, dueAt: new Date(now.getTime() + (await returnHours()) * 3600000) });
    const taken = await ColdBag.findOneAndUpdate({ _id: bag._id, status: 'available' }, { $set: { status: 'issued', issuedTo: riderId, currentIssue: issue._id } });
    if (!taken) {
      await issue.deleteOne();
      throw new ApiError(409, 'This cold bag was just taken by someone else');
    }
  }
  await Order.updateOne({ _id: order._id }, { $set: { coldBag: bag._id } });
  return bagView(await issue.populate('orders', 'orderNumber orderStatus'), bag);
}

// GET /delivery/cold-bags — bags I still have to return.
async function myBags(riderId) {
  const issues = await ColdBagIssue.find({ rider: riderId, status: 'issued' }).populate('bag', 'code label').populate('orders', 'orderNumber orderStatus').sort({ issuedAt: 1 });
  return issues.map((i) => bagView(i, i.bag));
}

// POST /delivery/cold-bags/return { code, lat, lng } — scan it back in at a store (the hub I'm
// checked in at, or any store I'm standing at).
async function returnBag(riderId, { code, lat, lng }) {
  const bag = await ColdBag.findOne({ code: String(code || '').trim().toUpperCase() });
  if (!bag || String(bag.issuedTo) !== String(riderId) || bag.status !== 'issued') throw new ApiError(404, "This cold bag isn't with you");
  const issue = await ColdBagIssue.findById(bag.currentIssue).populate('orders', 'orderStatus orderNumber');
  const open = (issue?.orders || []).filter((o) => !['delivered', 'cancelled', 'returned', 'delivery_failed'].includes(o.orderStatus));
  if (open.length) throw new ApiError(400, `Deliver ${open.map((o) => o.orderNumber).join(', ')} before returning the bag`);

  // Where am I?
  const profile = await DeliveryProfile.findOne({ user: riderId }).select('hubCheckin currentLat currentLng');
  let storeId = profile?.hubCheckin?.store && profile.hubCheckin.expiresAt > new Date() ? profile.hubCheckin.store : null;
  if (!storeId) {
    const pLat = Number.isFinite(Number(lat)) && lat !== undefined ? Number(lat) : profile?.currentLat;
    const pLng = Number.isFinite(Number(lng)) && lng !== undefined ? Number(lng) : profile?.currentLng;
    const radiusM = Number(await getSetting('geofencePickupMeters', 'GEOFENCE_PICKUP_METERS')) || 100;
    const stores = await Store.find({ status: 'active', lat: { $ne: null } }).select('lat lng');
    const near = stores.map((s) => ({ s, m: distanceKm(pLat, pLng, s.lat, s.lng) * 1000 })).filter((x) => x.m <= Math.max(radiusM, 150)).sort((a, b) => a.m - b.m)[0];
    storeId = near?.s._id || null;
  }
  if (!storeId) throw new ApiError(400, 'Reach a store to return the cold bag (or scan the hub QR first)');

  const now = new Date();
  await ColdBagIssue.updateOne({ _id: issue._id }, { $set: { status: 'returned', returnedAt: now, returnedStore: storeId } });
  await ColdBag.updateOne({ _id: bag._id }, { $set: { status: 'available', issuedTo: null, currentIssue: null, store: storeId } });
  return { code: bag.code, returnedAt: now, storeId, message: 'Cold bag returned. Thank you!' };
}

// ---- Admin ----------------------------------------------------------------------------------

// POST /admin/cold-bags { storeId, count, prefix? } -> new bags with printable QR labels.
async function createBags(storeId, count, prefix = 'CB') {
  if (!(await Store.exists({ _id: storeId }))) throw new ApiError(404, 'Store not found');
  const n = Math.min(Math.max(Number(count) || 1, 1), 200);
  const bags = [];
  for (let i = 0; i < n; i += 1) {
    let code;
    do code = `${String(prefix).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'CB'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    while (await ColdBag.exists({ code }));
    const bag = await ColdBag.create({ code, store: storeId });
    bags.push({ ...bag.toObject(), qrDataUrl: await QRCode.toDataURL(code, { margin: 1, width: 300 }) });
  }
  return bags;
}

async function listBags(query = {}) {
  const where = {};
  if (query.storeId) where.store = query.storeId;
  if (query.status) where.status = query.status;
  return ColdBag.find(where).populate('store', 'name').populate('issuedTo', 'name phone').sort({ code: 1 });
}

// Bags out past their return time.
async function overdueIssues() {
  return ColdBagIssue.find({ status: 'issued', dueAt: { $lt: new Date() } })
    .populate('bag', 'code').populate('rider', 'name phone').populate('orders', 'orderNumber').populate('store', 'name').sort({ dueAt: 1 });
}

// PATCH /admin/cold-bag-issues/:id/lost { amount?, title?, description? } -> bag lost; with an
// amount, deducted from the partner's pocket.
async function markLost(issueId, { amount, title, description }) {
  const issue = await ColdBagIssue.findById(issueId).populate('bag', 'code');
  if (!issue) throw new ApiError(404, 'Cold bag record not found');
  if (issue.status !== 'issued') throw new ApiError(400, `This bag was already ${issue.status}`);
  let txn = null;
  if (Number(amount) > 0) {
    txn = await require('./pocket.service').addDeduction(issue.rider, {
      amount: Number(amount),
      title: title || 'Cold bag not returned',
      description: description || `Cold Bag ${issue.bag?.code || ''} — ${t.dayLabel(issue.issuedAt)}`.trim(),
    });
  }
  issue.status = 'lost';
  issue.penaltyTxn = txn?._id || null;
  await issue.save();
  await ColdBag.updateOne({ _id: issue.bag._id }, { $set: { status: 'lost', issuedTo: null, currentIssue: null } });
  return issue;
}

module.exports = { markNeedsColdBag, requireForHandover, scanForOrder, myBags, returnBag, createBags, listBags, overdueIssues, markLost };
