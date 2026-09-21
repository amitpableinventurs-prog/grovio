const { Payment, Order, Refund } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { creditWallet } = require('../../services/payment.service');
const { logAdminActivity } = require('../../services/audit.service');
const { notifyUser } = require('../../services/notification.service');

// GET /admin/payments?status=&method=&instrument=
const listPayments = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, method, instrument } = req.query;

  const where = {};
  if (status) where.status = status;
  if (method) where.method = method;
  if (instrument) where.instrument = instrument;

  const [rows, count] = await Promise.all([
    Payment.find(where)
      .populate('order', 'orderNumber grandTotal')
      .populate('user', 'name phone email')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    Payment.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /admin/payments/cod-reconciliation?from=&to=&collectionMethod=
// COD orders are collected by the delivery partner at the door — either as physical cash (which
// they now hold and must hand over to the store) or via UPI (already digital, nothing to hand
// over). `cashCollected` is what actually needs settling; `upiCollected` is informational.
const codReconciliation = catchAsync(async (req, res) => {
  const { from, to, collectionMethod } = req.query;
  const match = { paymentMethod: 'COD', orderStatus: 'delivered', paymentStatus: 'paid' };
  if (from || to) {
    match.deliveredAt = {};
    if (from) match.deliveredAt.$gte = new Date(from);
    if (to) match.deliveredAt.$lte = new Date(to);
  }
  if (collectionMethod) match.codCollectionMethod = collectionMethod;

  const orders = await Order.find(match)
    .select('orderNumber grandTotal delivery deliveredAt settled codCollectionMethod')
    .populate('delivery', 'name phone');

  const cashOrders = orders.filter((o) => o.codCollectionMethod === 'cash');
  const upiOrders = orders.filter((o) => o.codCollectionMethod === 'upi');
  const totalCollected = orders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
  const cashCollected = cashOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
  const upiCollected = upiOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
  const unsettledCount = orders.filter((o) => !o.settled).length;
  const unsettledCashCount = cashOrders.filter((o) => !o.settled).length;

  new ApiResponse(200, {
    totalOrders: orders.length,
    totalCollected,
    cashCollected,
    upiCollected,
    unsettledCount,
    unsettledCashCount,
    orders,
  }).send(res);
});

// GET /admin/refunds?status=
const listRefunds = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status } = req.query;
  const where = status ? { status } : {};

  const [rows, count] = await Promise.all([
    Refund.find(where).populate('order', 'orderNumber customer').sort({ createdAt: -1 }).skip(offset).limit(limit),
    Refund.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// POST /admin/orders/:id/refund  { amount, reason }  -> manual/partial refund to the customer's wallet
const issueRefund = catchAsync(async (req, res) => {
  const { amount, reason } = req.body;
  if (!amount || amount <= 0) throw new ApiError(400, 'A positive refund amount is required');
  if (!reason) throw new ApiError(400, 'A refund reason is required');

  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');

  await creditWallet({ userId: order.customer, amount, reason: `Refund: ${reason}`, refOrderId: order._id });
  const refund = await Refund.create({ order: order._id, amount, reason, initiatedBy: req.user.id });

  if (Number(amount) >= Number(order.grandTotal)) {
    order.paymentStatus = 'refunded';
    await order.save();
  }

  await logAdminActivity({
    adminId: req.user.id,
    action: 'order.refund',
    entityType: 'Order',
    entityId: order._id,
    metadata: { amount, reason },
  });

  await notifyUser(order.customer, {
    title: `Refund issued for order ${order.orderNumber}`,
    body: `${amount} has been credited to your wallet.`,
    type: 'refund',
    data: { orderId: order._id, amount },
  });

  new ApiResponse(201, refund, 'Refund issued').send(res);
});

module.exports = { listPayments, codReconciliation, listRefunds, issueRefund };
