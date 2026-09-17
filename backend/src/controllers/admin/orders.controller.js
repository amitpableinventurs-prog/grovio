const { Order, PickerProfile, DeliveryProfile } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { transitionOrder } = require('../../services/order.service');
const { notifyUser } = require('../../services/notification.service');

const listOrders = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, storeId } = req.query;

  const where = {};
  if (status) where.orderStatus = status;
  if (storeId) where.store = storeId;

  const [rows, count] = await Promise.all([
    Order.find(where)
      .populate('customer', 'name phone')
      .populate('store', 'name')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    Order.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const getOrderDetail = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('customer', 'name phone')
    .populate('store')
    .populate('picker', 'name phone')
    .populate('delivery', 'name phone');
  if (!order) throw new ApiError(404, 'Order not found');
  new ApiResponse(200, order).send(res);
});

// PATCH /admin/orders/:id/assign-picker { pickerId }
const assignPicker = catchAsync(async (req, res) => {
  const { pickerId } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');

  const picker = await PickerProfile.findOne({ user: pickerId, status: 'approved' });
  if (!picker) throw new ApiError(400, 'Picker not found or not approved');

  order.picker = pickerId;
  await order.save();

  await notifyUser(pickerId, {
    title: 'New pick-list assigned',
    body: `Order ${order.orderNumber} has been assigned to you.`,
    type: 'picker_assignment',
    data: { orderId: order._id },
  });

  new ApiResponse(200, order, 'Picker assigned').send(res);
});

// PATCH /admin/orders/:id/assign-delivery { deliveryId }
const assignDelivery = catchAsync(async (req, res) => {
  const { deliveryId } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');

  const delivery = await DeliveryProfile.findOne({ user: deliveryId, status: 'approved' });
  if (!delivery) throw new ApiError(400, 'Delivery partner not found or not approved');

  order.delivery = deliveryId;
  await order.save();
  await transitionOrder({ order, toStatus: 'assigned', changedBy: req.user.id, note: 'Assigned by admin' });

  await notifyUser(deliveryId, {
    title: 'New delivery assigned',
    body: `Order ${order.orderNumber} has been assigned to you.`,
    type: 'delivery_assignment',
    data: { orderId: order._id },
  });

  new ApiResponse(200, order, 'Delivery partner assigned').send(res);
});

module.exports = { listOrders, getOrderDetail, assignPicker, assignDelivery };
