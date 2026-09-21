const { Order, PickerProfile } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { transitionOrder, ensureHandoverOtp } = require('../../services/order.service');
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

// Pick-lists (jobs) currently assigned to this picker
const listJobs = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status } = req.query;

  const where = { picker: req.user.id };
  where.orderStatus = status || { $in: ['accepted', 'picking', 'packed'] };

  const [rows, count] = await Promise.all([
    Order.find(where).populate('store', 'name address').sort({ createdAt: 1 }).skip(offset).limit(limit),
    Order.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /picker/history -> completed/rejected/cancelled jobs this picker handled
const listHistory = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);

  const where = { picker: req.user.id, orderStatus: { $in: ['delivered', 'cancelled', 'returned', 'delivery_failed'] } };

  const [rows, count] = await Promise.all([
    Order.find(where).populate('store', 'name').sort({ createdAt: -1 }).skip(offset).limit(limit),
    Order.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /picker/performance -> simple productivity stats
const getPerformance = catchAsync(async (req, res) => {
  const [totalPicked, substitutionsMade] = await Promise.all([
    Order.countDocuments({ picker: req.user.id, orderStatus: { $in: ['packed', 'assigned', 'out_for_delivery', 'delivered'] } }),
    Order.countDocuments({ picker: req.user.id, 'items.substituteProduct': { $ne: null } }),
  ]);

  const avgPickTimeAgg = await Order.aggregate([
    { $match: { picker: req.user.id, 'statusLogs.1': { $exists: true } } },
    { $unwind: '$statusLogs' },
    { $match: { 'statusLogs.status': { $in: ['picking', 'packed'] } } },
    { $group: { _id: '$_id', times: { $push: '$statusLogs.createdAt' } } },
    { $project: { diffMs: { $subtract: [{ $arrayElemAt: ['$times', 1] }, { $arrayElemAt: ['$times', 0] }] } } },
    { $group: { _id: null, avgMs: { $avg: '$diffMs' } } },
  ]);

  new ApiResponse(200, {
    totalPicked,
    substitutionsMade,
    avgPickTimeMinutes: avgPickTimeAgg[0]?.avgMs ? Number((avgPickTimeAgg[0].avgMs / 60000).toFixed(1)) : null,
  }).send(res);
});

async function findAssignedJob(req) {
  const order = await Order.findOne({ _id: req.params.id, picker: req.user.id }).populate('store');
  if (!order) throw new ApiError(404, 'Job not found or not assigned to you');
  return order;
}

const getJobDetail = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  new ApiResponse(200, order).send(res);
});

// POST /picker/jobs/:id/start  -> moves order to 'picking'
const startPicking = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  await transitionOrder({ order, toStatus: 'picking', changedBy: req.user.id, note: 'Picker started picking' });
  new ApiResponse(200, order, 'Started picking').send(res);
});

// PATCH /picker/jobs/:id/items/:itemId  { pickedQty, isAvailable, substituteProductId, substituteNote }
const updateJobItem = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  const item = order.items.id(req.params.itemId);
  if (!item) throw new ApiError(404, 'Order item not found');

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
// A dedicated alias of the item-update substitution path, matching a "record substitution" action.
const recordSubstitution = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  const { itemId, substituteProductId, substituteNote } = req.body;

  const item = order.items.id(itemId);
  if (!item) throw new ApiError(404, 'Order item not found');

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

// GET /picker/jobs/:id/otp -> the handover OTP to read out to the delivery partner in person.
// Auto-generated when a delivery partner is first assigned (see order.service.js#transitionOrder);
// this endpoint just redisplays it, regenerating on the fly if it has since expired.
const getHandoverOtp = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, picker: req.user.id })
    .select('+handoverOtp +handoverOtpExpiresAt orderStatus delivery orderNumber');
  if (!order) throw new ApiError(404, 'Job not found or not assigned to you');
  if (!order.delivery) throw new ApiError(400, 'No delivery partner assigned to this order yet');
  if (!['assigned', 'packed'].includes(order.orderStatus)) {
    throw new ApiError(400, `Handover OTP is not applicable while order is '${order.orderStatus}'`);
  }

  const freshlyGenerated = ensureHandoverOtp(order);
  if (freshlyGenerated) await order.save();

  new ApiResponse(200, { otp: order.handoverOtp, expiresAt: order.handoverOtpExpiresAt }).send(res);
});

// POST /picker/jobs/:id/complete -> moves order to 'packed' and best-effort assigns delivery
const completeJob = catchAsync(async (req, res) => {
  const order = await findAssignedJob(req);
  await transitionOrder({ order, toStatus: 'packed', changedBy: req.user.id, note: 'Order packed by picker' });

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

  new ApiResponse(200, order, 'Order packed').send(res);
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
  getHandoverOtp,
  completeJob,
};
