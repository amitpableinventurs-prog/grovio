const { Order, PickerProfile, DeliveryProfile, Refund } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { transitionOrder } = require('../../services/order.service');
const { notifyUser } = require('../../services/notification.service');
const { splitOrderAcrossPickers } = require('../../services/assignment.service');
const { creditWallet } = require('../../services/payment.service');
const { resolveStoreScope, hasFullAccess } = require('../../utils/storeScope');
const { PERMISSIONS } = require('../../utils/permissions');

// GET /admin/orders?storeId=&status=
// A full MANAGE_ORDERS admin sees everything (optionally filtered by storeId). A restricted
// store-manager (MANAGE_OWN_STORE_INVENTORY + assignedStore) only ever sees orders their own
// store is involved in — as the hub (order.store) OR as a contributing store on a multi-store
// order (items[].pickupStore), since their store's pickers still need to work those items even
// when some other store ends up as the hub.
const listOrders = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status } = req.query;

  const scopedStoreId = resolveStoreScope(req.user, req.query.storeId, PERMISSIONS.MANAGE_ORDERS);

  const where = {};
  if (status) where.orderStatus = status;
  if (scopedStoreId) where.$or = [{ store: scopedStoreId }, { 'items.pickupStore': scopedStoreId }];

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

// Same "hub OR contributing store" visibility as listOrders above — resolveStoreScope alone would
// wrongly 403 a contributing (non-hub) store-manager, since it only ever checks order.store.
function assertOrderVisible(user, order) {
  if (hasFullAccess(user, PERMISSIONS.MANAGE_ORDERS)) return;
  const scopedStoreId = resolveStoreScope(user, null, PERMISSIONS.MANAGE_ORDERS);
  const involved = order.store.toString() === scopedStoreId
    || order.items.some((i) => i.pickupStore.toString() === scopedStoreId);
  if (!involved) throw new ApiError(403, 'You can only manage your assigned store.');
}

const getOrderDetail = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('customer', 'name phone')
    .populate('store')
    .populate('pickTasks.picker', 'name phone')
    .populate('delivery', 'name phone');
  if (!order) throw new ApiError(404, 'Order not found');
  assertOrderVisible(req.user, order);
  new ApiResponse(200, order).send(res);
});

// PATCH /admin/orders/:id/accept — store accepts an incoming ('placed') order.
// Open to full MANAGE_ORDERS admins and to the store-manager who owns this order's store.
const acceptOrder = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  resolveStoreScope(req.user, order.store, PERMISSIONS.MANAGE_ORDERS);

  await transitionOrder({ order, toStatus: 'accepted', changedBy: req.user.id, note: 'Accepted by store' });

  // Best-effort split across up to 3 available pickers at the fulfilling store — see
  // assignment.service.js#splitOrderAcrossPickers. (In practice customer orders are
  // auto-accepted at placement — see customer/orders.controller.js — so this path mainly covers
  // an order that was left at 'placed' for some reason and needs a manual push.)
  const pickerIds = await splitOrderAcrossPickers(order);
  if (pickerIds.length) {
    await order.save();
    await transitionOrder({ order, toStatus: 'picking', changedBy: req.user.id, note: `Split across ${pickerIds.length} picker(s)` });
    await Promise.all(pickerIds.map((pickerId) => notifyUser(pickerId, {
      title: 'New pick-list assigned',
      body: `Order ${order.orderNumber} is ready to be picked.`,
      type: 'picker_assignment',
      data: { orderId: order._id },
    })));
  }

  new ApiResponse(200, order, 'Order accepted').send(res);
});

// PATCH /admin/orders/:id/reject { reason }
const rejectOrder = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  resolveStoreScope(req.user, order.store, PERMISSIONS.MANAGE_ORDERS);

  order.cancelReason = req.body.reason || 'Rejected by store';
  await order.save();
  await transitionOrder({ order, toStatus: 'rejected', changedBy: req.user.id, note: order.cancelReason });

  new ApiResponse(200, order, 'Order rejected').send(res);
});

// PATCH /admin/orders/:id/assign-picker { itemId, pickerId }
// Reassigns ONE item to a (possibly new) picker. The automatic 3-way split at order acceptance
// (see assignment.service.js#splitOrderAcrossPickers) is the default path — this is for manually
// rebalancing afterward, e.g. a picker goes offline mid-order. Creates a pickTask for the target
// picker if they weren't already working this order.
const assignPicker = catchAsync(async (req, res) => {
  const { itemId, pickerId } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');

  const item = order.items.id(itemId);
  if (!item) throw new ApiError(404, 'Order item not found');

  const picker = await PickerProfile.findOne({ user: pickerId, status: 'approved' });
  if (!picker) throw new ApiError(400, 'Picker not found or not approved');
  // A picker can only physically pick items sitting at their own store.
  if (picker.store.toString() !== item.pickupStore.toString()) {
    throw new ApiError(400, "This picker isn't at the store this item is picked from");
  }

  item.assignedPicker = pickerId;
  if (!order.pickTasks.some((t) => t.picker.toString() === pickerId)) {
    const isHub = item.pickupStore.toString() === order.store.toString();
    order.pickTasks.push({ picker: pickerId, store: item.pickupStore, status: 'assigned', handoffStatus: isHub ? 'not_required' : 'pending' });
  }
  await order.save();

  await notifyUser(pickerId, {
    title: 'New pick-list item assigned',
    body: `An item on order ${order.orderNumber} has been assigned to you.`,
    type: 'picker_assignment',
    data: { orderId: order._id, itemId: item._id },
  });

  new ApiResponse(200, order, 'Item reassigned').send(res);
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

// PATCH /admin/orders/:id/cancel { reason } — admin/store-manager cancels an in-flight order
// (there was previously no way to cancel one past 'placed'; rejectOrder above only covers that
// initial state). Refunds to the customer's wallet if the order was already paid, same as the
// customer's own self-cancel path.
const cancelOrder = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  resolveStoreScope(req.user, order.store, PERMISSIONS.MANAGE_ORDERS);

  order.cancelReason = req.body.reason || 'Cancelled by admin';
  await order.save();
  await transitionOrder({ order, toStatus: 'cancelled', changedBy: req.user.id, note: order.cancelReason });

  if (order.paymentStatus === 'paid') {
    await creditWallet({ userId: order.customer, amount: order.grandTotal, reason: 'Order cancellation refund', refOrderId: order._id });
    await Refund.create({ order: order._id, amount: order.grandTotal, reason: order.cancelReason, initiatedBy: req.user.id });
    order.paymentStatus = 'refunded';
    await order.save();
  }

  new ApiResponse(200, order, 'Order cancelled').send(res);
});

// PATCH /admin/orders/:id/mark-returned { reason } — admin equivalent of the Delivery Boy's
// POST /delivery/jobs/:id/return, for when RTO is coordinated by phone instead of through the
// delivery app. Only valid from 'delivery_failed', same as the delivery-side path. Refunds the
// customer if already paid, since they never received the item.
const markReturned = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  resolveStoreScope(req.user, order.store, PERMISSIONS.MANAGE_ORDERS);

  const reason = req.body.reason;
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

module.exports = { listOrders, getOrderDetail, acceptOrder, rejectOrder, assignPicker, assignDelivery, cancelOrder, markReturned };
