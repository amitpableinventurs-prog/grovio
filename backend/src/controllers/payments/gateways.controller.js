const { Order } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { apiBaseUrl, customerWebUrl } = require('../../services/gateways');
const payu = require('../../services/gateways/payu');
const phonepe = require('../../services/gateways/phonepe');

// PayU and PhonePe checkout — see services/gateways/payu.js and phonepe.js for the flows.

async function payableOrder(req, method) {
  const order = await Order.findOne({ _id: req.body.orderId, customer: req.user.id });
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.paymentMethod !== method) throw new ApiError(400, `This order was placed with ${order.paymentMethod}, not ${method}`);
  if (order.paymentStatus === 'paid') throw new ApiError(400, 'Order is already paid');
  if (['cancelled', 'rejected'].includes(order.orderStatus)) throw new ApiError(400, 'This order is no longer active');
  return order;
}

const returnUrl = async (gateway, orderId, status) => {
  const params = new URLSearchParams({ gateway, orderId: orderId || '' });
  if (status) params.set('status', status);
  return `${await customerWebUrl()}/payment/return?${params.toString()}`;
};

// POST /payments/payu/create { orderId } -> { action, fields }: the customer web app builds a form
// with these fields and submits it to `action` (PayU's hosted payment page).
const createPayu = catchAsync(async (req, res) => {
  const order = await payableOrder(req, 'PAYU');
  const callbackUrl = `${await apiBaseUrl(req)}/api/v1/payments/payu/callback`;
  new ApiResponse(200, await payu.createPayment({ order, user: req.user, callbackUrl }), 'PayU payment created').send(res);
});

// POST /payments/payu/callback — PayU's surl/furl (browser form POST). Verifies, records, and sends
// the browser back to the customer web app.
const payuCallback = catchAsync(async (req, res) => {
  const { status } = await payu.handleResponse(req.body || {});
  res.redirect(303, await returnUrl('payu', req.body?.udf1, status));
});

// POST /payments/payu/webhook — PayU server-to-server notification (same fields as the callback).
const payuWebhook = catchAsync(async (req, res) => {
  const { status } = await payu.handleResponse(req.body || {});
  res.status(status === 'invalid' ? 400 : 200).json({ received: status !== 'invalid' });
});

// POST /payments/phonepe/create { orderId } -> { redirectUrl }: send the customer there.
const createPhonepe = catchAsync(async (req, res) => {
  const order = await payableOrder(req, 'PHONEPE');
  const result = await phonepe.createPayment({ order, user: req.user, redirectUrl: await returnUrl('phonepe', order.id) });
  new ApiResponse(200, result, 'PhonePe payment created').send(res);
});

// POST /payments/phonepe/verify { orderId } — called by the return page. Checks with PhonePe.
const verifyPhonepe = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.body.orderId, customer: req.user.id });
  if (!order) throw new ApiError(404, 'Order not found');
  const payment = await phonepe.checkOrderPayment(order._id);
  const fresh = await Order.findById(order._id);
  new ApiResponse(200, { order: fresh, paymentStatus: payment.status }, payment.status === 'paid' ? 'Payment successful' : 'Payment not completed').send(res);
});

// POST /payments/phonepe/webhook
const phonepeWebhook = catchAsync(async (req, res) => {
  const result = await phonepe.handleWebhook(req.get('authorization'), req.body);
  if (!result.ok) return res.status(401).json({ received: false });
  res.status(200).json({ received: true });
});

module.exports = { createPayu, payuCallback, payuWebhook, createPhonepe, verifyPhonepe, phonepeWebhook };
