const { Order, DeliveryProfile, Wallet, WalletTransaction } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { transitionOrder } = require('../../services/order.service');
const { creditWallet } = require('../../services/payment.service');

const getProfile = catchAsync(async (req, res) => {
  const profile = await DeliveryProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');
  new ApiResponse(200, profile).send(res);
});

const updateProfile = catchAsync(async (req, res) => {
  const profile = await DeliveryProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');

  const { vehicleType, vehicleNumber, licenseNumber } = req.body;
  if (vehicleType !== undefined) profile.vehicleType = vehicleType;
  if (vehicleNumber !== undefined) profile.vehicleNumber = vehicleNumber;
  if (licenseNumber !== undefined) profile.licenseNumber = licenseNumber;
  await profile.save();

  new ApiResponse(200, profile, 'Profile updated').send(res);
});

const toggleAvailability = catchAsync(async (req, res) => {
  const profile = await DeliveryProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');
  profile.isAvailable = !!req.body.isAvailable;
  await profile.save();
  new ApiResponse(200, profile, 'Availability updated').send(res);
});

// POST /delivery/location  { lat, lng }
const updateLocation = catchAsync(async (req, res) => {
  const { lat, lng } = req.body;
  const profile = await DeliveryProfile.findOne({ user: req.user.id });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');

  profile.currentLat = lat;
  profile.currentLng = lng;
  await profile.save();

  new ApiResponse(200, profile, 'Location updated').send(res);
});

// GET /delivery/jobs?status=  -> defaults to active jobs; pass status=available to see none
// (auto-assignment already targets this partner directly — there is no open job pool to browse).
const listJobs = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status } = req.query;

  const where = { delivery: req.user.id };
  where.orderStatus = status || { $in: ['assigned', 'out_for_delivery'] };

  const [rows, count] = await Promise.all([
    Order.find(where)
      .populate('store', 'name address lat lng')
      .populate('address')
      .populate('customer', 'name phone')
      .sort({ createdAt: 1 })
      .skip(offset)
      .limit(limit),
    Order.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /delivery/history -> completed/failed/cancelled jobs
const listHistory = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = { delivery: req.user.id, orderStatus: { $in: ['delivered', 'delivery_failed', 'returned', 'cancelled'] } };

  const [rows, count] = await Promise.all([
    Order.find(where).populate('store', 'name').sort({ createdAt: -1 }).skip(offset).limit(limit),
    Order.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

async function findAssignedOrder(req, { withPin = false } = {}) {
  let query = Order.findOne({ _id: req.params.id, delivery: req.user.id }).populate('address').populate('store');
  if (withPin) query = query.select('+deliveryPin');
  const order = await query;
  if (!order) throw new ApiError(404, 'Order not found or not assigned to you');
  return order;
}

const getJobDetail = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  new ApiResponse(200, order).send(res);
});

// POST /delivery/jobs/:id/accept -> confirms the delivery partner has accepted this assignment
const acceptJob = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  order.deliveryAcceptedAt = new Date();
  await order.save();
  new ApiResponse(200, order, 'Job accepted').send(res);
});

// POST /delivery/jobs/:id/reject { reason } -> unassigns, awaiting reassignment
const rejectAssignment = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  order.delivery = null;
  order.deliveryAcceptedAt = null;
  order.orderStatus = 'packed';
  await order.save();
  new ApiResponse(200, order, 'Assignment rejected. Awaiting reassignment.').send(res);
});

// POST /delivery/jobs/:id/arrived-pickup -> marks arrival at the store, no status change yet
const markArrivedAtPickup = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  order.arrivedAtPickupAt = new Date();
  await order.save();
  new ApiResponse(200, order, 'Arrival at store recorded').send(res);
});

// POST /delivery/jobs/:id/picked-up -> out_for_delivery
const markPickedUp = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  await transitionOrder({ order, toStatus: 'out_for_delivery', changedBy: req.user.id, note: 'Picked up from store' });
  new ApiResponse(200, order, 'Marked as out for delivery').send(res);
});

// POST /delivery/jobs/:id/arrived-drop -> marks arrival at customer, no status change yet
const markArrivedAtDrop = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  order.arrivedAtDropAt = new Date();
  await order.save();
  new ApiResponse(200, order, 'Arrival at customer recorded').send(res);
});

// POST /delivery/jobs/:id/complete { pin }
const completeJob = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req, { withPin: true });

  const { pin } = req.body;
  if (!pin || pin !== order.deliveryPin) {
    throw new ApiError(400, 'Incorrect delivery PIN. Ask the customer for the PIN sent to them.');
  }

  if (order.paymentMethod === 'COD') {
    order.paymentStatus = 'paid';
    await order.save();
  }

  await transitionOrder({ order, toStatus: 'delivered', changedBy: req.user.id, note: 'Delivered to customer' });

  // Credit a flat delivery earning to the delivery partner's wallet.
  const deliveryEarning = Number(order.deliveryFee);
  if (deliveryEarning > 0) {
    await creditWallet({ userId: req.user.id, amount: deliveryEarning, reason: 'Delivery earning', refOrderId: order._id });
  }

  new ApiResponse(200, order, 'Order delivered').send(res);
});

// POST /delivery/jobs/:id/failed { reason }
const markFailed = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  const { reason } = req.body;
  if (!reason) throw new ApiError(400, 'A failure reason is required');

  order.failureReason = reason;
  await order.save();
  await transitionOrder({ order, toStatus: 'delivery_failed', changedBy: req.user.id, note: reason });

  new ApiResponse(200, order, 'Delivery marked as failed').send(res);
});

const getEarnings = catchAsync(async (req, res) => {
  const wallet = await Wallet.findOne({ user: req.user.id });
  const transactions = await WalletTransaction.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(50);
  new ApiResponse(200, { balance: wallet ? wallet.balance : 0, transactions }).send(res);
});

module.exports = {
  getProfile,
  updateProfile,
  toggleAvailability,
  updateLocation,
  listJobs,
  listHistory,
  getJobDetail,
  acceptJob,
  rejectAssignment,
  markArrivedAtPickup,
  markPickedUp,
  markArrivedAtDrop,
  completeJob,
  markFailed,
  getEarnings,
};
