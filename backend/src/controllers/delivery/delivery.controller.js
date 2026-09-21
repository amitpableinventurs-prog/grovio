const { Order, PickerProfile, DeliveryProfile, Payment, Wallet, WalletTransaction, Refund } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { transitionOrder, verifyHandoverOtp, verifyHandoverQr } = require('../../services/order.service');
const { creditWallet } = require('../../services/payment.service');

const COD_COLLECTION_METHODS = ['cash', 'upi'];

// GET /delivery/profile -> profile fields plus the account's name/phone/status, so the
// Delivery app's profile screen doesn't need a separate call to /auth/me.
const getProfile = catchAsync(async (req, res) => {
  const profile = await DeliveryProfile.findOne({ user: req.user.id }).populate('user', 'name phone email isActive');
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

async function findAssignedOrder(req, { withPin = false, withOtp = false, withQr = false } = {}) {
  let query = Order.findOne({ _id: req.params.id, delivery: req.user.id }).populate('address').populate('store');
  if (withPin) query = query.select('+deliveryPin');
  if (withOtp) query = query.select('+handoverOtp +handoverOtpExpiresAt +handoverOtpAttempts');
  if (withQr) query = query.select('+handoverQrToken +handoverQrTokenExpiresAt');
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

// GET /delivery/jobs/:id/pickers -> the picker(s) assigned to this order (currently always one,
// per the current single-picker-per-order model — returned as an array so a future multi-picker
// order-to-picker mapping is a purely additive change on top of this same endpoint).
const listAssignedPickers = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  if (!order.picker) return new ApiResponse(200, []).send(res);

  const profile = await PickerProfile.findOne({ user: order.picker }).populate('user', 'name phone');
  new ApiResponse(200, profile ? [profile] : []).send(res);
});

// POST /delivery/jobs/:id/otp/verify { otp } -> validates the handover OTP the Picker read out
// in person. This is the only way an order can move to 'picked_up' (see order.service.js).
const verifyHandoverOtpCtrl = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req, { withOtp: true });
  if (!order.deliveryAcceptedAt) throw new ApiError(400, 'Accept this job before verifying the handover OTP');

  const { otp } = req.body;
  if (!otp) throw new ApiError(400, 'otp is required');

  const result = await verifyHandoverOtp({ order, code: otp, changedBy: req.user.id });
  if (!result.valid) {
    const messages = {
      not_generated: 'No handover OTP has been generated for this order yet',
      expired: 'This handover OTP has expired. Ask the picker to refresh it.',
      max_attempts: 'Too many incorrect attempts. Ask the picker to refresh the OTP.',
      invalid: `Incorrect OTP.${result.attemptsLeft != null ? ` ${result.attemptsLeft} attempt(s) left.` : ''}`,
    };
    throw new ApiError(400, messages[result.reason] || 'Invalid handover OTP');
  }

  new ApiResponse(200, order, 'Handover confirmed. Order picked up.').send(res);
});

// POST /delivery/jobs/:id/scan { qrToken, deviceId?, location?: { lat, lng } } -> scans the
// Picker's handover QR code. Alternative to POST .../otp/verify — either one completes the same
// handover (order -> picked_up). Every attempt, successful or not, is recorded in ScannerLog.
const scanHandoverQr = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req, { withQr: true });
  if (!order.deliveryAcceptedAt) throw new ApiError(400, 'Accept this job before scanning the handover QR');

  const { qrToken, deviceId, location } = req.body;
  if (!qrToken) throw new ApiError(400, 'qrToken is required');

  const result = await verifyHandoverQr({ order, qrToken, scannedBy: req.user.id, userType: 'delivery', deviceId, location });
  if (!result.valid) {
    const messages = {
      not_generated: 'No handover QR has been generated for this order yet',
      expired: 'This QR code has expired. Ask the picker to refresh it.',
      invalid: 'This QR code does not belong to this order',
    };
    throw new ApiError(400, messages[result.reason] || 'Invalid QR code');
  }

  new ApiResponse(200, order, 'Handover confirmed. Order picked up.').send(res);
});

// POST /delivery/jobs/:id/out-for-delivery -> picked_up -> out_for_delivery (departing the hub
// with the package). Requires the OTP-verified 'picked_up' status — see verifyHandoverOtpCtrl.
const markOutForDelivery = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  await transitionOrder({ order, toStatus: 'out_for_delivery', changedBy: req.user.id, note: 'Departed for delivery' });
  new ApiResponse(200, order, 'Marked as out for delivery').send(res);
});

// POST /delivery/jobs/:id/arrived-drop -> marks arrival at customer, no status change yet
const markArrivedAtDrop = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  order.arrivedAtDropAt = new Date();
  await order.save();
  new ApiResponse(200, order, 'Arrival at customer recorded').send(res);
});

// POST /delivery/jobs/:id/complete { pin, collectionMethod }
// `collectionMethod` ('cash' | 'upi') is required only for COD orders — it records how the
// delivery partner actually collected payment at the door: physical cash they now hold and must
// hand over to the store, or UPI paid directly (nothing physical to settle). See order.model.js.
const completeJob = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req, { withPin: true });

  const { pin, collectionMethod } = req.body;
  if (!pin || pin !== order.deliveryPin) {
    throw new ApiError(400, 'Incorrect delivery PIN. Ask the customer for the PIN sent to them.');
  }

  if (order.paymentMethod === 'COD') {
    if (!COD_COLLECTION_METHODS.includes(collectionMethod)) {
      throw new ApiError(400, `collectionMethod is required for COD orders and must be one of: ${COD_COLLECTION_METHODS.join(', ')}`);
    }

    order.paymentStatus = 'paid';
    order.codCollectionMethod = collectionMethod;
    await order.save();

    await Payment.create({
      order: order._id,
      user: order.customer,
      amount: order.grandTotal,
      method: 'COD',
      collectionMethod,
      status: 'paid',
    });
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

// POST /delivery/jobs/:id/return { reason } -> delivery_failed -> returned. Marks RTO complete:
// the delivery partner has brought the (never-delivered) item back to the store. Refunds the
// customer if they'd already paid, since they never received anything.
const markReturned = catchAsync(async (req, res) => {
  const order = await findAssignedOrder(req);
  const { reason } = req.body;
  if (!reason) throw new ApiError(400, 'A return reason is required');

  order.cancelReason = reason;
  await order.save();
  await transitionOrder({ order, toStatus: 'returned', changedBy: req.user.id, note: reason });

  if (order.paymentStatus === 'paid') {
    await creditWallet({ userId: order.customer, amount: order.grandTotal, reason: 'Order returned - refund', refOrderId: order._id });
    await Refund.create({ order: order._id, amount: order.grandTotal, reason, initiatedBy: req.user.id });
    order.paymentStatus = 'refunded';
    await order.save();
  }

  new ApiResponse(200, order, 'Order marked as returned').send(res);
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
  listAssignedPickers,
  verifyHandoverOtpCtrl,
  scanHandoverQr,
  markOutForDelivery,
  markArrivedAtDrop,
  completeJob,
  markFailed,
  markReturned,
  getEarnings,
};
