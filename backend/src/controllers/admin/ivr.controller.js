const { IvrCall, Order } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { hasFullAccess, resolveStoreScope } = require('../../utils/storeScope');
const { PERMISSIONS } = require('../../utils/permissions');
const { logAdminActivity } = require('../../services/audit.service');
const ivr = require('../../services/ivr.service');

// GET /admin/ivr/calls?type=&status=&orderId= -> call log, newest first
const listCalls = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = {};
  if (req.query.type) where.type = req.query.type;
  if (req.query.status) where.status = req.query.status;
  if (req.query.orderId) where.order = req.query.orderId;

  const [items, count] = await Promise.all([
    IvrCall.find(where)
      .populate('user', 'name phone')
      .populate('order', 'orderNumber orderStatus')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    IvrCall.countDocuments(where),
  ]);
  new ApiResponse(200, { items, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /admin/ivr/config -> provider state + the webhook URLs to paste into the Exotel flows
const getConfig = catchAsync(async (req, res) => {
  const cfg = await ivr.ivrConfig();
  const base = cfg.baseUrl || `${req.protocol}://${req.get('host')}`;
  new ApiResponse(200, {
    provider: cfg.provider,
    publicBaseUrlSet: !!cfg.baseUrl,
    autoCallEvents: cfg.autoEvents,
    availableEvents: ivr.AUTO_CALL_EVENTS,
    webhooks: await ivr.webhookUrls(base),
  }).send(res);
});

// POST /admin/orders/:id/ivr-call { kind: 'status' | 'confirmation' } -> call the customer now
const callCustomer = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found');
  if (!hasFullAccess(req.user, PERMISSIONS.MANAGE_ORDERS)) {
    const scoped = resolveStoreScope(req.user, null, PERMISSIONS.MANAGE_ORDERS);
    if (order.store.toString() !== scoped) throw new ApiError(403, 'You can only manage your assigned store.');
  }

  const kind = req.body.kind || 'status';
  let call;
  if (kind === 'confirmation') {
    if (order.paymentMethod !== 'COD') throw new ApiError(400, 'Confirmation calls are only for cash on delivery orders');
    call = await ivr.requestOrderConfirmation(order, { force: true });
  } else {
    call = await ivr.callOrderStatus(order);
  }
  if (!call) throw new ApiError(400, 'The customer has no phone number on file');

  await logAdminActivity({ adminId: req.user.id, action: 'ivr.call', entityType: 'Order', entityId: order._id, metadata: { kind, callId: call._id } });
  new ApiResponse(200, call, call.status === 'failed' ? `Call failed: ${call.error}` : 'Call placed').send(res);
});

module.exports = { listCalls, getConfig, callCustomer };
