const { Order, Vendor, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { transitionOrder } = require('../../services/order.service');
const { findAvailablePicker } = require('../../services/assignment.service');
const { notifyUser } = require('../../services/notification.service');

async function getVendorId(userId) {
  const vendor = await Vendor.findOne({ user: userId });
  if (!vendor) throw new ApiError(404, 'Vendor profile not found');
  return vendor._id;
}

// GET /vendor/orders?storeId=&status=  -> storeId optional (defaults to all of the vendor's stores)
const listOrders = catchAsync(async (req, res) => {
  const vendorId = await getVendorId(req.user.id);
  const { page, limit, offset } = getPagination(req.query);
  const { storeId, status } = req.query;

  const where = { vendor: vendorId };
  if (storeId) where.store = storeId;
  if (status) where.orderStatus = status;

  const [rows, count] = await Promise.all([
    Order.find(where).populate('customer', 'name phone').populate('store', 'name').sort({ createdAt: -1 }).skip(offset).limit(limit),
    Order.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

async function findOwnedOrder(req) {
  const vendorId = await getVendorId(req.user.id);
  const order = await Order.findOne({ _id: req.params.id, vendor: vendorId });
  if (!order) throw new ApiError(404, 'Order not found');
  return { order, vendorId };
}

const getOrderDetail = catchAsync(async (req, res) => {
  const { order } = await findOwnedOrder(req);
  new ApiResponse(200, order).send(res);
});

const acceptOrder = catchAsync(async (req, res) => {
  const { order } = await findOwnedOrder(req);
  await transitionOrder({ order, toStatus: 'accepted', changedBy: req.user.id, note: 'Accepted by vendor' });

  // Best-effort auto-assign a picker linked to the fulfilling store.
  const picker = await findAvailablePicker(order.store);
  if (picker) {
    order.picker = picker.user;
    await order.save();
    await notifyUser(picker.user, {
      title: 'New pick-list assigned',
      body: `Order ${order.orderNumber} is ready to be picked.`,
      type: 'picker_assignment',
      data: { orderId: order._id },
    });
  }

  new ApiResponse(200, order, 'Order accepted').send(res);
});

const rejectOrder = catchAsync(async (req, res) => {
  const { order } = await findOwnedOrder(req);
  const { reason } = req.body;
  order.cancelReason = reason || 'Rejected by vendor';
  await order.save();
  await transitionOrder({ order, toStatus: 'rejected', changedBy: req.user.id, note: order.cancelReason });
  new ApiResponse(200, order, 'Order rejected').send(res);
});

module.exports = { listOrders, getOrderDetail, acceptOrder, rejectOrder };
