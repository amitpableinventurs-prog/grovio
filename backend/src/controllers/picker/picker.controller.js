// Multi-picker architecture: an order is split across up to 3 pickers PER STORE it draws items
// from (see assignment.service.js#splitOrderAcrossPickers), each responsible for the items whose
// orderItem.assignedPicker matches them (order.pickTasks tracks each picker's own progress).
// order.store is the hub — for a single-store order that's just "the store", the same as always;
// for a cart spanning multiple stores, the other stores' pickers each carry their picked portion
// to the hub in person and hand it off there (pickTask.handoffStatus) before the order can be
// packed for the single delivery-partner pickup — see order.service.js#verifyHandoffOtp.
const { Order, PickerProfile, Product } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const {
  transitionOrder, ensureHandoverOtp, ensureHandoverQrToken, advancePickingStatus, ensureHandoffOtp, verifyHandoffOtp,
} = require('../../services/order.service');
const { findNearestDeliveryPartner } = require('../../services/assignment.service');
const { notifyUser } = require('../../services/notification.service');

const getProfile = catchAsync(async (req, res) => {
  const profile = await PickerProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Picker profile not found');
  new ApiResponse(200, profile).send(res);
});

const toggleAvailability = catchAsync(async (req, res) => {
  const profile = await PickerProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Picker profile not found');
  profile.isAvailable = !!req.body.isAvailable;
  await profile.save();
  new ApiResponse(200, profile, 'Availability updated').send(res);
});

// POST /picker/location  { lat, lng }  -> live GPS, used to pick the dynamic Apex consolidation point
const updateLocation = catchAsync(async (req, res) => {
  const { lat, lng } = req.body;
  const profile = await PickerProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Picker profile not found');

  profile.currentLat = lat;
  profile.currentLng = lng;
  profile.locationUpdatedAt = new Date();
  profile.onlineStatus = 'online';
  await profile.save();

  new ApiResponse(200, profile, 'Location updated').send(res);
});

const getLocation = catchAsync(async (req, res) => {
  const profile = await PickerProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Picker profile not found');

  new ApiResponse(200, {
    lat: profile.currentLat,
    lng: profile.currentLng,
    updatedAt: profile.locationUpdatedAt,
    onlineStatus: profile.onlineStatus,
  }).send(res);
});

// Pick-lists (jobs) currently assigned to this picker — any order where they hold a pickTask,
// regardless of how many other pickers are also working it.
const listJobs = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status } = req.query;

  const where = { 'pickTasks.picker': req.user.id };
  where.orderStatus = status || { $in: ['accepted', 'picking', 'partially_picked', 'packed'] };

  const [rows, count] = await Promise.all([
    Order.find(where).populate('store', 'name address').sort({ createdAt: 1 }).skip(offset).limit(limit),
    Order.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /picker/history -> completed/rejected/cancelled jobs this picker handled
const listHistory = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);

  const where = { 'pickTasks.picker': req.user.id, orderStatus: { $in: ['delivered', 'cancelled', 'returned', 'delivery_failed'] } };

  const [rows, count] = await Promise.all([
    Order.find(where).populate('store', 'name').sort({ createdAt: -1 }).skip(offset).limit(limit),
    Order.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /picker/performance -> simple productivity stats, counted over just this picker's own
// pickTask (not the whole order, which may include other pickers' items too).
const getPerformance = catchAsync(async (req, res) => {
  const myOrders = await Order.find({ 'pickTasks.picker': req.user.id }, 'pickTasks items').lean();

  let totalPicked = 0;
  let substitutionsMade = 0;
  const pickDurations = [];

  for (const order of myOrders) {
    const myTask = order.pickTasks.find((t) => t.picker.toString() === req.user.id);
    if (!myTask) continue;
    if (myTask.status === 'completed') totalPicked += 1;
    if (myTask.startedAt && myTask.completedAt) {
      pickDurations.push(new Date(myTask.completedAt) - new Date(myTask.startedAt));
    }
    substitutionsMade += order.items.filter(
      (i) => i.assignedPicker?.toString() === req.user.id && i.substituteProduct
    ).length;
  }

  const avgPickTimeMinutes = pickDurations.length
    ? Number((pickDurations.reduce((a, b) => a + b, 0) / pickDurations.length / 60000).toFixed(1))
    : null;

  new ApiResponse(200, { totalPicked, substitutionsMade, avgPickTimeMinutes }).send(res);
});

async function findAssignedJob(req) {
  const order = await Order.findOne({ _id: req.params.id, 'pickTasks.picker': req.user.id }).populate('store');
  if (!order) throw new ApiError(404, 'Job not found or not assigned to you');
  return order;
}

function myPickTask(order, userId) {
  return order.pickTasks.find((t) => t.picker.toString() === userId);
}

// Item-level ownership check — being on the order's pickTasks isn't enough to touch an item that
// was assigned to a different picker.
function myItem(order, itemId, userId) {
  const item = order.items.id(itemId);
  if (!item || item.assignedPicker?.toString() !== userId) return null;
  return item;
}

const getJobDetail = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  new ApiResponse(200, order).send(res);
});

// POST /picker/jobs/:id/start -> marks THIS picker's own pickTask 'picking' (the order itself is
// already 'picking'/'partially_picked' from the moment it was split — see
// assignment.service.js#splitOrderAcrossPickers — so there's no order-level transition here).
const startPicking = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  const task = myPickTask(order, req.user.id);
  if (!task) throw new ApiError(404, 'Job not found or not assigned to you');
  if (task.status === 'assigned') {
    task.status = 'picking';
    task.startedAt = new Date();
    await order.save();
  }
  new ApiResponse(200, order, 'Started picking').send(res);
});

// POST /picker/jobs/:id/items/:itemId/scan  { qrToken, qty }
// Verifies the scanned product QR matches this specific item before accepting it as picked —
// a wrong scan is rejected outright rather than silently recorded. Only works on items assigned
// to the calling picker; someone else's items on the same order are invisible to this endpoint.
const scanItem = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  const item = myItem(order, req.params.itemId, req.user.id);
  if (!item) throw new ApiError(404, 'Item not found or not assigned to you');

  const { qrToken, qty } = req.body;
  if (!qrToken) throw new ApiError(400, 'qrToken is required');

  const product = await Product.findById(item.product);
  if (!product) throw new ApiError(404, 'Product no longer exists');
  if (!product.qrToken || product.qrToken !== qrToken) {
    throw new ApiError(400, 'Scanned item does not match this order item');
  }

  const pickedQty = qty !== undefined ? Number(qty) : item.qty;
  if (Number.isNaN(pickedQty) || pickedQty < 0) throw new ApiError(400, 'Invalid qty');

  item.pickedQty = pickedQty;
  item.pickedAt = new Date();
  await order.save();

  new ApiResponse(200, item, 'Item scanned').send(res);
});

// PATCH /picker/jobs/:id/items/:itemId  { pickedQty, isAvailable, substituteProductId, substituteNote }
// Manual override alongside scanItem above — e.g. marking something out of stock doesn't involve
// scanning anything.
const updateJobItem = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  const item = myItem(order, req.params.itemId, req.user.id);
  if (!item) throw new ApiError(404, 'Item not found or not assigned to you');

  const { pickedQty, isAvailable, substituteProductId, substituteNote } = req.body;
  if (pickedQty !== undefined) item.pickedQty = pickedQty;
  if (isAvailable !== undefined) item.isAvailable = isAvailable;
  if (substituteProductId !== undefined) item.substituteProduct = substituteProductId || null;
  if (substituteNote !== undefined) item.substituteNote = substituteNote;
  await order.save();

  if (substituteProductId !== undefined) {
    await notifyUser(order.customer, {
      title: `Order ${order.orderNumber}`,
      body: `"${item.nameSnapshot}" is out of stock. The store has proposed a substitute — please check your order.`,
      type: 'item_substitution',
      data: { orderId: order._id, itemId: item._id },
    });
  }

  new ApiResponse(200, item, 'Item updated').send(res);
});

// POST /picker/jobs/:id/substitutions  { itemId, substituteProductId, substituteNote }
const recordSubstitution = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  const { itemId, substituteProductId, substituteNote } = req.body;

  const item = myItem(order, itemId, req.user.id);
  if (!item) throw new ApiError(404, 'Item not found or not assigned to you');

  item.isAvailable = false;
  item.substituteProduct = substituteProductId || null;
  item.substituteNote = substituteNote || null;
  await order.save();

  await notifyUser(order.customer, {
    title: `Order ${order.orderNumber}`,
    body: `"${item.nameSnapshot}" is out of stock. The store has proposed a substitute — please check your order.`,
    type: 'item_substitution',
    data: { orderId: order._id, itemId: item._id },
  });

  new ApiResponse(200, item, 'Substitution recorded').send(res);
});

// Only a picker physically AT the hub can hand the order to the delivery partner — for a
// single-store order that's every picker on it (same as before); for a multi-store order, other
// stores' pickers aren't at the pickup location, so they don't get to read out/show this.
function isHubPicker(order, userId) {
  return order.pickTasks.some((t) => t.picker.toString() === userId && t.store.toString() === order.store.toString());
}

// GET /picker/jobs/:id/otp -> the handover OTP to read out to the delivery partner in person.
// Any picker AT THE HUB can view/refresh it — the handover happens once, for the whole
// consolidated order, after all pickers are done, not per-picker.
const getHandoverOtp = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, 'pickTasks.picker': req.user.id })
    .select('+handoverOtp +handoverOtpExpiresAt orderStatus delivery orderNumber pickTasks store');
  if (!order || !isHubPicker(order, req.user.id)) throw new ApiError(404, 'Job not found or not assigned to you');
  if (!order.delivery) throw new ApiError(400, 'No delivery partner assigned to this order yet');
  if (!['assigned', 'packed'].includes(order.orderStatus)) {
    throw new ApiError(400, `Handover OTP is not applicable while order is '${order.orderStatus}'`);
  }

  const freshlyGenerated = ensureHandoverOtp(order);
  if (freshlyGenerated) await order.save();

  new ApiResponse(200, { otp: order.handoverOtp, expiresAt: order.handoverOtpExpiresAt }).send(res);
});

// GET /picker/jobs/:id/qr -> same idea as the OTP above, for the QR alternative.
const getHandoverQr = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, 'pickTasks.picker': req.user.id })
    .select('+handoverQrToken +handoverQrTokenExpiresAt orderStatus delivery orderNumber pickTasks store');
  if (!order || !isHubPicker(order, req.user.id)) throw new ApiError(404, 'Job not found or not assigned to you');
  if (!order.delivery) throw new ApiError(400, 'No delivery partner assigned to this order yet');
  if (!['assigned', 'packed'].includes(order.orderStatus)) {
    throw new ApiError(400, `Handover QR is not applicable while order is '${order.orderStatus}'`);
  }

  const freshlyGenerated = ensureHandoverQrToken(order);
  if (freshlyGenerated) await order.save();

  new ApiResponse(200, { qrToken: order.handoverQrToken, expiresAt: order.handoverQrTokenExpiresAt }).send(res);
});

// GET /picker/jobs/:id/handoff/otp -> for a NON-hub picker, once their own portion is picked: the
// code to read out to whoever receives it at the hub. Mirrors getHandoverOtp above, but scoped to
// this picker's own pickTask instead of the whole order.
const getHandoffOtp = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, 'pickTasks.picker': req.user.id })
    .select('+pickTasks.handoffOtp +pickTasks.handoffOtpExpiresAt pickTasks orderNumber');
  if (!order) throw new ApiError(404, 'Job not found or not assigned to you');

  const task = myPickTask(order, req.user.id);
  if (!task || task.handoffStatus === 'not_required') {
    throw new ApiError(400, 'Your portion of this order does not need to be handed off anywhere');
  }
  if (task.status !== 'completed') throw new ApiError(400, 'Finish picking your items before generating a handoff code');
  if (task.handoffStatus === 'delivered_to_hub') throw new ApiError(400, 'Already handed off to the hub');

  const freshlyGenerated = ensureHandoffOtp(task);
  if (freshlyGenerated) await order.save();

  new ApiResponse(200, { otp: task.handoffOtp, expiresAt: task.handoffOtpExpiresAt }).send(res);
});

// POST /picker/jobs/:id/handoff/verify  { code }  -> called by a picker AT THE HUB to confirm
// they've physically received another store's picked items. Whichever pending pickTask the code
// matches gets marked delivered — the caller doesn't need to know in advance which store it came
// from, only that a fellow picker just handed them a sealed bag and read out a number.
const verifyHandoff = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, 'pickTasks.picker': req.user.id })
    .select('+pickTasks.handoffOtp +pickTasks.handoffOtpExpiresAt +pickTasks.handoffOtpAttempts pickTasks store orderNumber');
  if (!order || !isHubPicker(order, req.user.id)) throw new ApiError(404, 'Job not found or not assigned to you');

  const { code } = req.body;
  if (!code) throw new ApiError(400, 'code is required');

  const result = await verifyHandoffOtp({ order, code, changedBy: req.user.id });
  if (!result.valid) {
    const messages = {
      not_generated: 'No handoff is pending for this order.',
      expired: 'This handoff code has expired.',
      max_attempts: 'Too many incorrect attempts.',
      invalid: 'Incorrect code. Please try again.',
    };
    throw new ApiError(400, messages[result.reason] || 'Invalid or expired code', [
      { reason: result.reason, attemptsLeft: result.attemptsLeft },
    ]);
  }

  new ApiResponse(200, order, 'Handoff confirmed').send(res);
});

// POST /picker/jobs/:id/complete -> marks THIS picker's own portion done. Once every picker on
// the order has done the same — and, for a store that isn't the hub, once their portion has also
// been handed off there (see getHandoffOtp/verifyHandoff above) — the order rolls up to 'packed'
// automatically (see order.service.js#advancePickingStatus) and a delivery partner is auto-assigned.
const completeMyPicking = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  const task = myPickTask(order, req.user.id);
  if (!task) throw new ApiError(404, 'Job not found or not assigned to you');
  if (task.status === 'completed') throw new ApiError(400, 'You have already completed your portion of this order');

  task.status = 'completed';
  task.completedAt = new Date();

  let handoffOtp = null;
  if (task.handoffStatus === 'pending') {
    handoffOtp = ensureHandoffOtp(task);
  }

  await order.save();

  if (handoffOtp) {
    await notifyUser(req.user.id, {
      title: `Order ${order.orderNumber}`,
      body: `Carry your picked items to ${order.store.name} and give this code when you hand them off: ${handoffOtp}`,
      type: 'handoff_otp',
      data: { orderId: order._id, handoffOtp },
    });
  }

  await advancePickingStatus({ order, changedBy: req.user.id });

  if (order.orderStatus === 'packed') {
    const delivery = await findNearestDeliveryPartner({ lat: order.store.lat, lng: order.store.lng });
    if (delivery) {
      order.delivery = delivery.user;
      await order.save();
      await transitionOrder({ order, toStatus: 'assigned', changedBy: req.user.id, note: 'Auto-assigned delivery partner' });
      await notifyUser(delivery.user, {
        title: 'New delivery assigned',
        body: `Order ${order.orderNumber} is ready for pickup.`,
        type: 'delivery_assignment',
        data: { orderId: order._id },
      });
    }
  }

  new ApiResponse(200, order, 'Your portion is marked complete').send(res);
});

module.exports = {
  getProfile,
  toggleAvailability,
  updateLocation,
  getLocation,
  listJobs,
  listHistory,
  getPerformance,
  getJobDetail,
  startPicking,
  scanItem,
  updateJobItem,
  recordSubstitution,
  getHandoverOtp,
  getHandoverQr,
  getHandoffOtp,
  verifyHandoff,
  completeMyPicking,
};
