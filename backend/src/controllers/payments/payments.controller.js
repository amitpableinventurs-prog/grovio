const { Order, Payment } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const paymentService = require('../../services/payment.service');
const { creditWallet } = require('../../services/payment.service');
const { notifyUser } = require('../../services/notification.service');
const { getSetting } = require('../../services/settings.service');
const { dispatchToPickers } = require('../../services/order.service');

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
    keyId: await getSetting('razorpayKeyId', 'RAZORPAY_KEY_ID'),
    orderId: order._id,
  }, 'Razorpay order created').send(res);
});

// POST /payments/razorpay/verify { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
const verifyRazorpayPayment = catchAsync(async (req, res) => {
  const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  const valid = await paymentService.verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
  if (!valid) throw new ApiError(400, 'Payment signature verification failed');

  const order = await Order.findOne({ _id: orderId, customer: req.user.id });
  if (!order) throw new ApiError(404, 'Order not found');

  order.paymentStatus = 'paid';
  await order.save();
  // Paid — now it can go to the pickers (no-op if the webhook already did this).
  await dispatchToPickers({ order, changedBy: order.customer });

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
  const isValid = await paymentService.verifyWebhookSignature(req.rawBody, signature);
  if (!isValid) throw new ApiError(400, 'Invalid webhook signature');

  const event = req.body.event;
  const paymentEntity = req.body.payload?.payment?.entity;

  // Orders are created with payment_capture: 0 (see payment.service.js), so a successful payment
  // lands here as 'authorized' first — nothing is actually captured (or paid for) until we
  // explicitly capture it. Re-validating the amount before capturing is the whole reason to do
  // this ourselves instead of just turning on auto-capture: it stops a tampered/mismatched amount
  // from ever being captured. The payment.captured event Razorpay sends after a successful
  // capture (handled below) is what actually marks the Payment/Order/Wallet paid.
  if (event === 'payment.authorized' && paymentEntity) {
    const payment = await Payment.findOne({ gatewayOrderId: paymentEntity.order_id });
    if (payment && payment.status !== 'paid') {
      const expectedPaise = Math.round(Number(payment.amount) * 100);
      if (paymentEntity.amount !== expectedPaise) {
        console.error(`Razorpay authorized amount mismatch for payment ${payment._id}: expected ${expectedPaise}, got ${paymentEntity.amount} — not capturing`);
      } else {
        try {
          await paymentService.capturePayment(paymentEntity.id, expectedPaise, paymentEntity.currency || 'INR');
        } catch (err) {
          console.error(`Failed to capture Razorpay payment ${paymentEntity.id}:`, err.message);
        }
      }
    }
  }

  if (event === 'payment.captured' && paymentEntity) {
    const payment = await Payment.findOne({ gatewayOrderId: paymentEntity.order_id });
    // Idempotency: a webhook can be delivered more than once, and the client's own verify call
    // (see verifyRazorpayPayment/verifyAddMoney) may have already processed this payment first.
    if (payment && payment.status !== 'paid') {
      payment.status = 'paid';
      payment.gatewayPaymentId = paymentEntity.id;
      payment.instrument = paymentEntity.method || null;
      payment.rawResponse = paymentEntity;
      await payment.save();

      if (payment.purpose === 'wallet_topup') {
        await creditWallet({ userId: payment.user, amount: payment.amount, reason: 'Wallet top-up' });
        await notifyUser(payment.user, {
          title: 'Money added',
          body: `₹${payment.amount} was added to your Grovio Wallet.`,
          type: 'wallet_topup_success',
          data: { paymentId: payment._id },
        });
      } else {
        const order = await Order.findById(payment.order);
        if (order && order.paymentStatus !== 'paid') {
          order.paymentStatus = 'paid';
          await order.save();
          await dispatchToPickers({ order, changedBy: order.customer });
          await notifyUser(order.customer, {
            title: 'Payment received',
            body: `Payment for order ${order.orderNumber} was successful.`,
            type: 'payment_success',
            data: { orderId: order._id },
          });
        }
      }
    }
  }

  // Authoritative failure signal — a customer can close the checkout widget or lose connectivity
  // before the client-side failure callback (see reportRazorpayFailure/retryAddMoney below) ever
  // fires, so this webhook is what actually guarantees a failed attempt gets recorded.
  if (event === 'payment.failed' && paymentEntity) {
    const payment = await Payment.findOne({ gatewayOrderId: paymentEntity.order_id });
    if (payment && payment.status !== 'paid') {
      payment.status = 'failed';
      payment.gatewayPaymentId = paymentEntity.id;
      payment.failureReason = paymentEntity.error_description || 'Payment failed';
      payment.rawResponse = paymentEntity;
      await payment.save();

      if (payment.purpose === 'wallet_topup') {
        await notifyUser(payment.user, {
          title: 'Add money failed',
          body: `We couldn't add ₹${payment.amount} to your wallet. Please try again.`,
          type: 'wallet_topup_failed',
          data: { paymentId: payment._id },
        });
      } else {
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
  }

  res.status(200).json({ received: true });
});

module.exports = { createRazorpayOrder, verifyRazorpayPayment, reportRazorpayFailure, razorpayWebhook };
