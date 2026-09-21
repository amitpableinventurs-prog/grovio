const { Order, Payment } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const paymentService = require('../../services/payment.service');
const { notifyUser } = require('../../services/notification.service');

// POST /payments/razorpay/create  { orderId }
const createRazorpayOrder = catchAsync(async (req, res) => {
  const { orderId } = req.body;

  const order = await Order.findOne({ _id: orderId, customer: req.user.id });
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.paymentStatus === 'paid') throw new ApiError(400, 'Order is already paid');

  const { razorpayOrder } = await paymentService.createRazorpayOrder({ order, userId: req.user.id });

  new ApiResponse(200, {
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    orderId: order._id,
  }, 'Razorpay order created').send(res);
});

// POST /payments/razorpay/verify { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
const verifyRazorpayPayment = catchAsync(async (req, res) => {
  const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  const valid = paymentService.verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
  if (!valid) throw new ApiError(400, 'Payment signature verification failed');

  const order = await Order.findOne({ _id: orderId, customer: req.user.id });
  if (!order) throw new ApiError(404, 'Order not found');

  order.paymentStatus = 'paid';
  await order.save();

  const payment = await Payment.findOne({ order: order._id, gatewayOrderId: razorpayOrderId });
  if (payment) {
    payment.gatewayPaymentId = razorpayPaymentId;
    payment.status = 'paid';
    payment.instrument = await paymentService.fetchPaymentInstrument(razorpayPaymentId);
    await payment.save();
  }

  new ApiResponse(200, order, 'Payment verified successfully').send(res);
});

// POST /payments/razorpay/failure { orderId, razorpayOrderId, razorpayPaymentId?, reason? }
// The Razorpay checkout widget reports a failed/cancelled attempt to the CLIENT, not the backend —
// this lets the app forward that so the order doesn't sit stuck at paymentStatus 'pending' forever
// with no record of what happened. The webhook's own 'payment.failed' handler below is the
// authoritative version of this (a client callback can be skipped e.g. if the app is killed), so
// this never overwrites an already-paid order.
const reportRazorpayFailure = catchAsync(async (req, res) => {
  const { orderId, razorpayOrderId, razorpayPaymentId, reason } = req.body;

  const order = await Order.findOne({ _id: orderId, customer: req.user.id });
  if (!order) throw new ApiError(404, 'Order not found');
  if (order.paymentStatus === 'paid') return new ApiResponse(200, order, 'Order is already paid').send(res);

  order.paymentStatus = 'failed';
  await order.save();

  const payment = await Payment.findOne({ order: order._id, gatewayOrderId: razorpayOrderId });
  if (payment && payment.status !== 'paid') {
    payment.status = 'failed';
    payment.gatewayPaymentId = razorpayPaymentId || payment.gatewayPaymentId;
    payment.failureReason = reason || 'Payment failed or cancelled';
    await payment.save();
  }

  new ApiResponse(200, order, 'Payment failure recorded').send(res);
});

// POST /payments/razorpay/webhook  (raw body, verified via header signature)
const razorpayWebhook = catchAsync(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const isValid = paymentService.verifyWebhookSignature(req.rawBody, signature);
  if (!isValid) throw new ApiError(400, 'Invalid webhook signature');

  const event = req.body.event;
  const paymentEntity = req.body.payload?.payment?.entity;

  if (event === 'payment.captured' && paymentEntity) {
    const payment = await Payment.findOne({ gatewayOrderId: paymentEntity.order_id });
    if (payment) {
      payment.status = 'paid';
      payment.gatewayPaymentId = paymentEntity.id;
      payment.instrument = paymentEntity.method || null;
      payment.rawResponse = paymentEntity;
      await payment.save();

      const order = await Order.findById(payment.order);
      if (order && order.paymentStatus !== 'paid') {
        order.paymentStatus = 'paid';
        await order.save();
        await notifyUser(order.customer, {
          title: 'Payment received',
          body: `Payment for order ${order.orderNumber} was successful.`,
          type: 'payment_success',
          data: { orderId: order._id },
        });
      }
    }
  }

  // Authoritative failure signal — a customer can close the checkout widget or lose connectivity
  // before the client-side failure callback (see reportRazorpayFailure above) ever fires, so this
  // webhook is what actually guarantees a failed attempt gets recorded.
  if (event === 'payment.failed' && paymentEntity) {
    const payment = await Payment.findOne({ gatewayOrderId: paymentEntity.order_id });
    if (payment && payment.status !== 'paid') {
      payment.status = 'failed';
      payment.gatewayPaymentId = paymentEntity.id;
      payment.failureReason = paymentEntity.error_description || 'Payment failed';
      payment.rawResponse = paymentEntity;
      await payment.save();

      const order = await Order.findById(payment.order);
      if (order && order.paymentStatus !== 'paid') {
        order.paymentStatus = 'failed';
        await order.save();
        await notifyUser(order.customer, {
          title: 'Payment failed',
          body: `Payment for order ${order.orderNumber} could not be completed. Please try again.`,
          type: 'payment_failed',
          data: { orderId: order._id },
        });
      }
    }
  }

  res.status(200).json({ received: true });
});

module.exports = { createRazorpayOrder, verifyRazorpayPayment, reportRazorpayFailure, razorpayWebhook };
