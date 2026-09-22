// Multi-picker architecture: an order is split across up to 3 pickers, one PER STORE it draws
// items from (see assignment.service.js#splitOrderAcrossPickers), each responsible for the items
// whose orderItem.assignedPicker matches them (order.pickTasks tracks each picker's own
// progress). Each picker just picks + packs their own portion AT THEIR OWN STORE and presses
// "Ready for Pickup" (task.status: 'completed') — there is no scanning and no physical hand-off
// between pickers. The delivery partner later visits every picker's store as its own pickup
// point and confirms collection there directly with that picker (scan or OTP) — see
// delivery.controller.js#verifyPickupOtpCtrl/scanPickupQr.
const { Order, PickerProfile } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { transitionOrder, ensurePickupOtp, ensurePickupQrToken, advancePickingStatus } = require('../../services/order.service');
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

// POST /picker/location  { lat, lng }
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

// PATCH /picker/jobs/:id/items/:itemId  { pickedQty, isAvailable, substituteProductId, substituteNote }
// The picker's only way to report an item — no scanning. Used both to record what was actually
// picked and, via isAvailable/substituteProductId, to flag something out of stock.
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

// GET /picker/jobs/:id/pickup/otp -> the pickup OTP to read out to the delivery partner when
// they arrive at THIS picker's store. Scoped to the calling picker's own pickTask only —
// auto-generated once a delivery partner is assigned (see order.service.js#transitionOrder),
// refreshed here if expired.
const getPickupOtp = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, 'pickTasks.picker': req.user.id })
    .select('+pickTasks.pickupOtp +pickTasks.pickupOtpExpiresAt');
  if (!order) throw new ApiError(404, 'Job not found or not assigned to you');
  if (!order.delivery) throw new ApiError(400, 'No delivery partner assigned to this order yet');

  const task = myPickTask(order, req.user.id);
  if (!task) throw new ApiError(404, 'Job not found or not assigned to you');
  if (task.pickedUpAt) throw new ApiError(400, 'This pickup has already been collected');

  const freshlyGenerated = ensurePickupOtp(task);
  if (freshlyGenerated) await order.save();

  new ApiResponse(200, { otp: task.pickupOtp, expiresAt: task.pickupOtpExpiresAt }).send(res);
});

// GET /picker/jobs/:id/pickup/qr -> same idea as the OTP above, for the QR alternative.
const getPickupQr = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, 'pickTasks.picker': req.user.id })
    .select('+pickTasks.pickupQrToken +pickTasks.pickupQrTokenExpiresAt');
  if (!order) throw new ApiError(404, 'Job not found or not assigned to you');
  if (!order.delivery) throw new ApiError(400, 'No delivery partner assigned to this order yet');

  const task = myPickTask(order, req.user.id);
  if (!task) throw new ApiError(404, 'Job not found or not assigned to you');
  if (task.pickedUpAt) throw new ApiError(400, 'This pickup has already been collected');

  const freshlyGenerated = ensurePickupQrToken(task);
  if (freshlyGenerated) await order.save();

  new ApiResponse(200, { qrToken: task.pickupQrToken, expiresAt: task.pickupQrTokenExpiresAt }).send(res);
});

// POST /picker/jobs/:id/complete -> marks THIS picker's own portion picked, packed and ready for
// pickup. Once every picker on the order has done the same, it rolls up to 'packed' ("fully
// ready for pickup" — see order.service.js#advancePickingStatus) and a delivery partner is
// auto-assigned.
const completeMyPicking = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  const task = myPickTask(order, req.user.id);
  if (!task) throw new ApiError(404, 'Job not found or not assigned to you');
  if (task.status === 'completed') throw new ApiError(400, 'You have already completed your portion of this order');

  task.status = 'completed';
  task.completedAt = new Date();
  await order.save();
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

  new ApiResponse(200, order, 'Your portion is marked ready for pickup').send(res);
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
  updateJobItem,
  recordSubstitution,
  getPickupOtp,
  getPickupQr,
  completeMyPicking,
};
