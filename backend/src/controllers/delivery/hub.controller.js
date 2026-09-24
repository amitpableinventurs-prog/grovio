const { Order, DeliveryProfile } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { transitionOrder } = require('../../services/order.service');
const {
  extractCheckinToken,
  consumeCheckinToken,
  checkinExpiry,
  activeCheckinStoreId,
} = require('../../services/hubDisplay.service');

// Delivery Boy at a Hub Center: scan the hub screen's QR to check in, see the hub's ready
// orders, pick one, then finish the pickup with the existing handover endpoints —
// POST /delivery/jobs/:id/scan (picker's package QR) or .../otp/verify, then .../out-for-delivery.
// See services/hubDisplay.service.js for how the check-in QR works.

async function getApprovedProfile(userId) {
  const profile = await DeliveryProfile.findOne({ user: userId });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');
  if (profile.status !== 'approved') throw new ApiError(403, 'Your account must be approved before you can pick up orders');
  return profile;
}

async function requireCheckedInHub(profile) {
  const storeId = activeCheckinStoreId(profile);
  if (!storeId) throw new ApiError(403, 'Check in at the hub first — scan the QR on the hub screen');
  return storeId;
}

const itemCount = (order) => (order.items || []).reduce((sum, i) => sum + (i.qty || 0), 0);

function toHubOrder(order) {
  const packed = [...(order.statusLogs || [])].reverse().find((l) => l.status === 'packed');
  return {
    _id: order._id,
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    itemCount: itemCount(order),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    grandTotal: order.grandTotal,
    readySince: packed?.createdAt || null,
    deliveryAcceptedAt: order.deliveryAcceptedAt,
    // Enough to choose between orders; the full address comes with GET /delivery/jobs/:id once
    // the order is theirs.
    dropArea: order.address
      ? { city: order.address.city, pincode: order.address.pincode, landmark: order.address.landmark, lat: order.address.lat, lng: order.address.lng }
      : null,
  };
}

// My orders at this hub (assigned / picked up, not yet departed) + packed orders nobody has yet.
async function hubOrders(storeId, userId) {
  const select = 'orderNumber orderStatus items.qty paymentMethod paymentStatus grandTotal statusLogs deliveryAcceptedAt address';
  const [mine, available] = await Promise.all([
    Order.find({ store: storeId, delivery: userId, orderStatus: { $in: ['assigned', 'picked_up'] } })
      .select(select).populate('address', 'city pincode landmark lat lng').sort({ updatedAt: 1 }),
    Order.find({ store: storeId, delivery: null, orderStatus: 'packed' })
      .select(select).populate('address', 'city pincode landmark lat lng').sort({ updatedAt: 1 }).limit(100),
  ]);
  return { mine: mine.map(toHubOrder), available: available.map(toHubOrder) };
}

function checkinPayload(profile, store, orders) {
  return {
    hub: { id: store._id, name: store.name, address: store.address, lat: store.lat, lng: store.lng },
    checkedInAt: profile.hubCheckin.at,
    expiresAt: profile.hubCheckin.expiresAt,
    ...orders,
  };
}

// POST /delivery/hub/checkin { code } -> `code` is what the app read from the hub screen's QR
// (the full URL or just its `t` token). Checks the partner in at that hub for HUB_CHECKIN_MINUTES
// and records arrival on their assigned orders there. The QR is single-use: this check-in replaces
// it on the screen, so the next partner scans a fresh one.
const checkIn = catchAsync(async (req, res) => {
  const profile = await getApprovedProfile(req.user.id);

  const token = extractCheckinToken(req.body.code);
  if (!token) throw new ApiError(400, 'code is required');

  // Only after the approval check above, so a rejected scan doesn't use up the QR on the screen.
  const display = await consumeCheckinToken(token);
  if (!display) throw new ApiError(400, 'This hub QR was already used or is not valid. Scan the QR currently showing on the hub screen.');
  const store = display.store;
  if (!store || store.status !== 'active') throw new ApiError(400, 'This hub is not active');

  const now = new Date();
  profile.hubCheckin = { store: store._id, display: display._id, at: now, expiresAt: checkinExpiry() };
  await profile.save();

  // Arrival at pickup, same as POST /delivery/jobs/:id/arrived-pickup — shows on the hub screen.
  const arriving = await Order.find({ store: store._id, delivery: req.user.id, orderStatus: 'assigned', arrivedAtPickupAt: null });
  for (const order of arriving) {
    order.arrivedAtPickupAt = now;
    await order.save();
  }

  const orders = await hubOrders(store._id, req.user.id);
  new ApiResponse(200, checkinPayload(profile, store, orders), `Checked in at ${store.name}`).send(res);
});

// GET /delivery/hub/orders -> the hub I'm checked in at, my orders there and unclaimed ready ones.
const listHubOrders = catchAsync(async (req, res) => {
  const profile = await getApprovedProfile(req.user.id);
  const storeId = await requireCheckedInHub(profile);
  await profile.populate('hubCheckin.store', 'name address lat lng');

  const orders = await hubOrders(storeId, req.user.id);
  new ApiResponse(200, checkinPayload(profile, profile.hubCheckin.store, orders)).send(res);
});

// POST /delivery/hub/orders/:id/claim -> takes a packed, unassigned order at my checked-in hub:
// assigns it to me and accepts it in one step (order -> assigned). Two partners claiming the same
// order at once: exactly one wins, the other gets 409.
const claimOrder = catchAsync(async (req, res) => {
  const profile = await getApprovedProfile(req.user.id);
  const storeId = await requireCheckedInHub(profile);

  const now = new Date();
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, store: storeId, orderStatus: 'packed', delivery: null },
    { $set: { delivery: req.user.id, deliveryAcceptedAt: now, arrivedAtPickupAt: now } },
    { new: true },
  );

  if (!order) {
    const existing = await Order.findOne({ _id: req.params.id, store: storeId }).select('orderStatus delivery');
    if (!existing) throw new ApiError(404, 'Order not found at this hub');
    if (existing.delivery?.toString() === req.user.id) throw new ApiError(400, 'This order is already yours');
    if (existing.delivery) throw new ApiError(409, 'Another delivery partner has already taken this order');
    throw new ApiError(400, `This order is not ready for pickup (status: ${existing.orderStatus})`);
  }

  try {
    await transitionOrder({ order, toStatus: 'assigned', changedBy: req.user.id, note: 'Claimed at hub by delivery partner' });
  } catch (err) {
    // Hand it back rather than leaving a 'packed' order stuck with a delivery partner on it.
    await Order.updateOne(
      { _id: order._id, delivery: req.user.id, orderStatus: 'packed' },
      { $set: { delivery: null, deliveryAcceptedAt: null, arrivedAtPickupAt: null } },
    );
    throw err;
  }

  new ApiResponse(200, order, 'Order assigned to you. Scan the package QR or enter the pickup OTP to collect it.').send(res);
});

// POST /delivery/hub/checkout -> ends the check-in early (it also expires on its own).
const checkOut = catchAsync(async (req, res) => {
  const profile = await DeliveryProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');
  profile.hubCheckin = { store: null, display: null, at: null, expiresAt: null };
  await profile.save();
  new ApiResponse(200, null, 'Checked out of the hub').send(res);
});

module.exports = { checkIn, listHubOrders, claimOrder, checkOut };
