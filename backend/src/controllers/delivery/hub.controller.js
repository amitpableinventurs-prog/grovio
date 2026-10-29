const { Order, DeliveryProfile, ScannerLog } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { transitionOrder } = require('../../services/order.service');
const { notifyUser } = require('../../services/notification.service');
const { getSetting } = require('../../services/settings.service');
const { navigationLinks } = require('../../services/directions.service');
const { distanceKm } = require('../../utils/geo');
const { emitToRooms, ROOMS } = require('../../sockets');
const { logServerError } = require('../../services/errorLog.service');
const {
  extractCheckinToken,
  parseHubCode,
  consumeCheckinToken,
  checkinExpiry,
  activeCheckinStoreId,
  firstName,
} = require('../../services/hubDisplay.service');

// Delivery Boy at a Hub Center. Two ways to get an order there:
//  - Scan a ready order's own QR on the hub screen: POST /delivery/hub/scan takes the order and
//    picks it up in one step (the default 'hub_screen' pickup mode — see hubDisplay.service.js).
//  - Scan the screen's check-in QR, see the hub's ready orders, claim one, then finish the pickup
//    with POST /delivery/jobs/:id/scan (picker's QR) or .../otp/verify.
// Either way the rider then leaves with POST /delivery/jobs/:id/out-for-delivery.

async function getApprovedProfile(userId) {
  const profile = await DeliveryProfile.findOne({ user: userId });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');
  if (profile.status !== 'approved') throw new ApiError(403, 'Your account must be approved before you can pick up orders');
  await require('../../services/accountHold.service').assertNotOnHold(userId);
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

  const { payload, message } = await checkInWithToken(req, profile, token);
  new ApiResponse(200, payload, message).send(res);
});

async function checkInWithToken(req, profile, token) {
  // Only after the approval check, so a rejected scan doesn't use up the QR on the screen.
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
  return { payload: checkinPayload(profile, store, orders), message: `Checked in at ${store.name}` };
}

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

// POST /delivery/hub/scan { code, lat?, lng?, deviceId? } -> the one scanner in the Delivery app for
// anything on a hub screen. `code` is the scanned QR content (full URL or just the token):
//  - a ready order's QR (…/hub-checkin/?p=…): takes the order and picks it up — see pickUpByScan
//  - the check-in QR (…/hub-checkin/?t=…): same as POST /delivery/hub/checkin
// Response: { type: 'pickup' | 'checkin', ... }.
const scan = catchAsync(async (req, res) => {
  const profile = await getApprovedProfile(req.user.id);
  const parsed = parseHubCode(req.body.code);
  if (!parsed) throw new ApiError(400, 'code is required — the content of the QR scanned on the hub screen');

  if (parsed.kind === 'checkin') {
    const { payload, message } = await checkInWithToken(req, profile, parsed.token);
    return new ApiResponse(200, { type: 'checkin', ...payload }, message).send(res);
  }
  const { payload, message } = await pickUpByScan(req, profile, parsed.token);
  return new ApiResponse(200, { type: 'pickup', ...payload }, message).send(res);
});

// Where the rider is for the hub-distance check: the lat/lng sent with the scan, else their last
// GPS ping if it's recent.
const LOCATION_FRESH_MS = 10 * 60 * 1000;
function scanPosition(body, profile) {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (body?.lat != null && body?.lng != null && Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  const fresh = profile.locationUpdatedAt && Date.now() - profile.locationUpdatedAt.getTime() < LOCATION_FRESH_MS;
  if (fresh && Number.isFinite(profile.currentLat) && Number.isFinite(profile.currentLng)) return { lat: profile.currentLat, lng: profile.currentLng };
  return null;
}

// An order's QR on the hub screen was scanned. In order:
//  1. The QR must still be live (cleared once the order is picked up) and the order ready at its hub.
//  2. The rider must be online and at the hub — within the pickup geofence (min 150 m, as GPS
//     indoors is rough), so a photo of the screen sent to someone elsewhere doesn't work.
//  3. Unassigned (packed) -> it's theirs: assigned + accepted. Two riders scanning at once: one
//     gets it, the other a 409. Already assigned to them (auto-assign mode, or waiting for a cold
//     bag) -> carry on. Assigned to someone else -> 409.
//  4. Frozen items without a cold bag yet: stop here — the order stays theirs and its QR stays on
//     the screen; they scan a cold bag (POST /delivery/jobs/:id/cold-bag) and then this QR again.
//  5. Otherwise picked up (assigned -> picked_up). The QR leaves the screen, which flashes
//     "#1234 -> Ramesh" (hub:pickup) so the hub picker hands over the right bag.
// Every attempt on a known order is recorded in ScannerLog (qrType 'hub_pickup').
async function pickUpByScan(req, profile, token) {
  const riderId = req.user.id;
  let order = await Order.findOne({ hubPickupToken: token })
    .select('+hubPickupToken')
    .populate('store', 'name address lat lng status');
  if (!order) throw new ApiError(400, 'This order QR is no longer valid. Scan the QR showing on the hub screen.');

  const { deviceId } = req.body || {};
  const position = scanPosition(req.body, profile);
  const log = (status, failureReason = null) => ScannerLog.create({
    order: order._id, qrType: 'hub_pickup', qrToken: token, scannedBy: riderId, userType: 'delivery',
    deviceId: deviceId || null, location: position || undefined, status, failureReason,
  }).catch((err) => logServerError('Scanner log failed', err));
  const fail = async (status, reason, message) => {
    await log('failed', reason);
    throw new ApiError(status, message);
  };

  const store = order.store;
  if (!store || store.status !== 'active') await fail(400, 'hub_inactive', 'This hub is not active');
  if (!profile.isAvailable) await fail(400, 'offline', 'Go online to pick up orders');
  if (order.delivery && order.delivery.toString() !== riderId) {
    await fail(409, 'taken', 'Another delivery partner has already taken this order');
  }
  if (!['packed', 'assigned'].includes(order.orderStatus)) {
    await fail(400, 'not_ready', `This order is not ready for pickup (status: ${order.orderStatus})`);
  }

  if (Number.isFinite(store.lat) && Number.isFinite(store.lng)) {
    if (!position) await fail(400, 'no_location', 'Turn on location and scan again — we need to check you are at the hub');
    const radiusM = Math.max(Number(await getSetting('geofencePickupMeters', 'GEOFENCE_PICKUP_METERS')) || 100, 150);
    const awayM = distanceKm(position.lat, position.lng, store.lat, store.lng) * 1000;
    if (awayM > radiusM) {
      await fail(400, 'too_far', `You are ${Math.round(awayM)} m from ${store.name}. Scan the QR at the hub.`);
    }
  }

  const now = new Date();
  if (!order.delivery) {
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, hubPickupToken: token, orderStatus: 'packed', delivery: null },
      { $set: { delivery: riderId, deliveryAcceptedAt: now, arrivedAtPickupAt: now } },
      { new: true },
    ).select('+hubPickupToken').populate('store', 'name address lat lng status');
    if (!claimed) await fail(409, 'taken', 'Another delivery partner has just taken this order');
    order = claimed;
    try {
      await transitionOrder({ order, toStatus: 'assigned', changedBy: riderId, note: 'Hub screen QR scanned by delivery partner', notifyHubPickers: false });
    } catch (err) {
      // Hand it back rather than leaving a 'packed' order stuck with a delivery partner on it.
      await Order.updateOne(
        { _id: order._id, delivery: riderId, orderStatus: 'packed' },
        { $set: { delivery: null, deliveryAcceptedAt: null, arrivedAtPickupAt: null } },
      );
      throw err;
    }
  } else {
    // Already theirs: scanning it at the hub also counts as accepting it and arriving.
    order.deliveryAcceptedAt = order.deliveryAcceptedAt || now;
    order.arrivedAtPickupAt = order.arrivedAtPickupAt || now;
    await order.save();
  }

  // Checked in at this hub, as with the check-in QR (cold bags and GET /delivery/hub/orders use it).
  profile.hubCheckin = { store: store._id, display: null, at: now, expiresAt: checkinExpiry() };
  await profile.save();

  const rider = firstName((await profile.populate('user', 'name')).user?.name) || 'Rider';
  const pickedUp = !(order.needsColdBag && !order.coldBag);
  if (pickedUp) {
    order.handoverQrToken = null;
    order.handoverQrTokenExpiresAt = null;
    order.handoverOtp = null;
    order.handoverOtpExpiresAt = null;
    await transitionOrder({ order, toStatus: 'picked_up', changedBy: riderId, note: 'Hub screen QR scanned' });
  }
  await log('success', pickedUp ? null : 'cold_bag_pending');

  emitToRooms([ROOMS.hub(store._id.toString())], 'hub:pickup', {
    orderId: order._id, orderNumber: order.orderNumber, rider, pickedUp,
  });
  const hubPickerIds = [...new Set((order.pickTasks || [])
    .filter((t) => t.store.toString() === store._id.toString()).map((t) => t.picker.toString()))];
  await Promise.all(hubPickerIds.map((pickerId) => notifyUser(pickerId, {
    title: `Order ${order.orderNumber}`,
    body: pickedUp ? `${rider} scanned this order. Hand over the bag.` : `${rider} took this order and is getting a cold bag.`,
    type: 'hub_pickup',
    data: { orderId: order._id, rider, pickedUp },
  })));

  const detail = await Order.findById(order._id)
    .populate('address')
    .populate('store', 'name address lat lng')
    .populate('customer', 'name');
  // 0,0 is an address saved without a location, not a real place.
  const a = detail.address;
  const drop = a && Number.isFinite(a.lat) && Number.isFinite(a.lng) && (a.lat || a.lng) ? { lat: a.lat, lng: a.lng } : null;
  return {
    payload: {
      pickedUp,
      nextStep: pickedUp ? 'start_delivery' : 'scan_cold_bag',
      order: detail,
      drop,
      navigation: drop ? navigationLinks(position, drop) : null,
    },
    message: pickedUp
      ? `Order ${order.orderNumber} is yours. Take the bag and start the delivery.`
      : `Order ${order.orderNumber} is yours. It has frozen items: scan a cold bag, then scan this order's QR again.`,
  };
}

// POST /delivery/hub/checkout -> ends the check-in early (it also expires on its own).
const checkOut = catchAsync(async (req, res) => {
  const profile = await DeliveryProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');
  profile.hubCheckin = { store: null, display: null, at: null, expiresAt: null };
  await profile.save();
  new ApiResponse(200, null, 'Checked out of the hub').send(res);
});

module.exports = { checkIn, scan, listHubOrders, claimOrder, checkOut };
