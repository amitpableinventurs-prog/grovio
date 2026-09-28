const { VoipCall } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const voip = require('../../services/voip.service');

// GET /admin/voip/calls?status=&orderId= -> masked customer <-> rider calls, newest first
const listCalls = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.orderId) where.order = req.query.orderId;

  await voip.expireStaleCalls();
  const [items, count] = await Promise.all([
    VoipCall.find(where)
      .populate('caller', 'name phone')
      .populate('callee', 'name phone')
      .populate('order', 'orderNumber orderStatus')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    VoipCall.countDocuments(where),
  ]);
  new ApiResponse(200, { items, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /admin/voip/config -> provider state, what's missing, and the URLs for the Twilio TwiML App
const getConfig = catchAsync(async (req, res) => {
  const cfg = await voip.voipConfig();
  const base = cfg.baseUrl || `${req.protocol}://${req.get('host')}`;
  new ApiResponse(200, {
    provider: cfg.provider,
    publicBaseUrlSet: !!cfg.baseUrl,
    missing: cfg.provider === 'twilio' ? voip.missingConfig(cfg) : [],
    callableStatuses: voip.CALLABLE_STATUSES,
    webhooks: voip.webhookUrls(base),
  }).send(res);
});

module.exports = { listCalls, getConfig };
