const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { Order } = require('../../models');
const voip = require('../../services/voip.service');

// Masked customer <-> delivery partner calls (services/voip.service.js).

// GET /voip/token?platform=web|android|ios -> Twilio access token for the Voice SDK, or
// { enabled: false } when in-app calling is switched off.
const getToken = catchAsync(async (req, res) => {
  const platform = ['android', 'ios'].includes(req.query.platform) ? req.query.platform : 'web';
  new ApiResponse(200, await voip.accessToken(req.user, platform)).send(res);
});

const ORDER_FIELDS = 'orderNumber orderStatus customer delivery';

// POST /customer/orders/:id/call -> call my delivery partner
const callFromCustomer = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customer: req.user.id }).select(ORDER_FIELDS);
  if (!order) throw new ApiError(404, 'Order not found');
  new ApiResponse(201, await voip.startCall(order, req.user)).send(res);
});

// POST /delivery/jobs/:id/call -> call the customer on this job
const callFromDelivery = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, delivery: req.user.id }).select(ORDER_FIELDS);
  if (!order) throw new ApiError(404, 'Order not found or not assigned to you');
  new ApiResponse(201, await voip.startCall(order, req.user)).send(res);
});

// ---- Twilio webhooks (public, checked by X-Twilio-Signature) ----------------------------------

const params = (req) => ({ ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) });
const xml = (res, body) => res.status(200).type('text/xml').send(body);

const checkSignature = catchAsync(async (req, res, next) => {
  if (!(await voip.verifyWebhook(req))) throw new ApiError(403, 'Invalid signature');
  next();
});

const voice = catchAsync(async (req, res) => xml(res, await voip.voiceTwiml(params(req))));
const dialResult = catchAsync(async (req, res) => xml(res, await voip.handleDialResult(params(req))));
const clientStatus = catchAsync(async (req, res) => {
  await voip.handleClientStatus(params(req));
  res.status(204).end();
});
const status = catchAsync(async (req, res) => {
  await voip.handleStatus(params(req));
  res.status(204).end();
});

module.exports = { getToken, callFromCustomer, callFromDelivery, checkSignature, voice, dialResult, clientStatus, status };
