const { User, DeliveryProfile, Wallet, Order } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { resolvePhone } = require('../../utils/phone');
const { logAdminActivity } = require('../../services/audit.service');

// A delivery job the partner is still expected to act on — 'delivery_failed' is included because
// it isn't terminal (it can still move to out_for_delivery/returned/cancelled from there, see
// order.service.js TRANSITIONS), so this partner may still be needed to finish it.
const NON_TERMINAL_STATUSES = ['assigned', 'picked_up', 'out_for_delivery', 'delivery_failed'];

// POST /admin/delivery-partners — Admin-only onboarding, alongside the existing
// self-registration path (see auth.controller.js#verifyOtp). Created directly as 'approved'
// since the admin has already vetted them.
const createDeliveryPartner = catchAsync(async (req, res) => {
  const { name, email, vehicleType, vehicleNumber, licenseNumber } = req.body;
  const phone = resolvePhone(req.body);

  const existing = await User.findOne({ phone });
  if (existing) throw new ApiError(409, 'A user with this mobile number already exists');

  const user = await User.create({
    name,
    email: email || undefined,
    phone,
    role: 'delivery',
    isVerified: true,
  });

  const profile = await DeliveryProfile.create({
    user: user._id,
    vehicleType: vehicleType || null,
    vehicleNumber: vehicleNumber || null,
    licenseNumber: licenseNumber || null,
    status: 'approved',
  });

  await Wallet.create({ user: user._id, balance: 0 });

  await logAdminActivity({
    adminId: req.user.id,
    action: 'delivery.create',
    entityType: 'DeliveryProfile',
    entityId: profile._id,
    metadata: { phone },
  });

  new ApiResponse(201, { user, deliveryProfile: profile }, 'Delivery partner created').send(res);
});

// PUT /admin/delivery-partners/:id — full edit of an existing delivery partner
const updateDeliveryPartner = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'delivery' });
  if (!user) throw new ApiError(404, 'Delivery partner not found');

  const profile = await DeliveryProfile.findOne({ user: user._id });
  if (!profile) throw new ApiError(404, 'Delivery profile not found');

  const { name, email } = req.body;
  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  await user.save();

  ['vehicleType', 'vehicleNumber', 'licenseNumber'].forEach((field) => {
    if (req.body[field] !== undefined) profile[field] = req.body[field];
  });
  await profile.save();

  await logAdminActivity({
    adminId: req.user.id,
    action: 'delivery.update',
    entityType: 'DeliveryProfile',
    entityId: profile._id,
    metadata: req.body,
  });

  new ApiResponse(200, { user, deliveryProfile: profile }, 'Delivery partner updated').send(res);
});

// DELETE /admin/delivery-partners/:id — refuses if a job is still in progress with them, so an
// active delivery never loses its assigned partner out from under it.
const deleteDeliveryPartner = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'delivery' });
  if (!user) throw new ApiError(404, 'Delivery partner not found');

  const activeOrder = await Order.findOne({ delivery: user._id, orderStatus: { $in: NON_TERMINAL_STATUSES } });
  if (activeOrder) {
    throw new ApiError(400, `Cannot delete — order ${activeOrder.orderNumber} is still in progress with this delivery partner`);
  }

  await DeliveryProfile.deleteOne({ user: user._id });
  await User.deleteOne({ _id: user._id });

  await logAdminActivity({
    adminId: req.user.id,
    action: 'delivery.delete',
    entityType: 'User',
    entityId: user._id,
    metadata: { phone: user.phone },
  });

  new ApiResponse(200, null, 'Delivery partner deleted').send(res);
});

module.exports = { createDeliveryPartner, updateDeliveryPartner, deleteDeliveryPartner };
