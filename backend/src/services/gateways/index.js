const { Order } = require('../../models');
const { getSetting } = require('../settings.service');
const { notifyUser } = require('../notification.service');
const { dispatchToPickers } = require('../order.service');

// Shared bits for the payment gateways (Razorpay lives in ../payment.service.js; PayU and PhonePe
// in this folder): which payment options checkout offers, and marking a gateway payment paid or
// failed once the gateway has confirmed it.

const enabled = (value) => String(value ?? '').toLowerCase() !== 'false';

// What checkout offers, in display order. A gateway only shows once its credentials are set and it
// hasn't been switched off in Admin > Settings. placeOrder() rejects anything not in this list.
async function enabledPaymentOptions() {
  const options = [];
  if (enabled(await getSetting('codEnabled', 'COD_ENABLED'))) {
    options.push({ method: 'COD', label: 'Cash on Delivery', description: 'Pay by cash or UPI when your order arrives' });
  }
  options.push({ method: 'WALLET', label: 'Grovio Wallet', description: 'Pay from your wallet balance' });
  if (enabled(await getSetting('razorpayEnabled', 'RAZORPAY_ENABLED'))) {
    options.push({ method: 'RAZORPAY', label: 'UPI / Card / Netbanking', description: 'Pay online with Razorpay' });
  }
  if (enabled(await getSetting('phonepeEnabled', 'PHONEPE_ENABLED'))
    && (await getSetting('phonepeClientId', 'PHONEPE_CLIENT_ID')) && (await getSetting('phonepeClientSecret', 'PHONEPE_CLIENT_SECRET'))) {
    options.push({ method: 'PHONEPE', label: 'PhonePe', description: 'UPI, cards and netbanking via PhonePe' });
  }
  if (enabled(await getSetting('payuEnabled', 'PAYU_ENABLED'))
    && (await getSetting('payuKey', 'PAYU_KEY')) && (await getSetting('payuSalt', 'PAYU_SALT'))) {
    options.push({ method: 'PAYU', label: 'PayU', description: 'UPI, debit/credit card, netbanking and wallets via PayU' });
  }
  return options;
}

// Where the customer web app lives — gateways send the customer back there after paying.
async function customerWebUrl() {
  return ((await getSetting('customerWebUrl', 'CUSTOMER_WEB_URL')) || 'http://localhost:5174').replace(/\/+$/, '');
}

// Our own public origin, for gateway callbacks (PayU posts the result back to us).
async function apiBaseUrl(req) {
  const configured = ((await getSetting('publicBaseUrl', 'PUBLIC_BASE_URL')) || '').replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

// Gateway confirmed the money arrived. Idempotent: callbacks, webhooks and status checks can all
// report the same payment, only the first one does anything. Also rejects an amount mismatch.
async function markPaid(payment, { gatewayPaymentId, instrument, amount, raw }) {
  if (payment.status === 'paid') return { changed: false };
  if (amount !== undefined && Math.round(Number(amount) * 100) !== Math.round(Number(payment.amount) * 100)) {
    payment.status = 'failed';
    payment.failureReason = `Amount mismatch: expected ${payment.amount}, gateway reported ${amount}`;
    payment.rawResponse = raw ?? null;
    await payment.save();
    console.error(`Payment ${payment._id}: ${payment.failureReason}`);
    return { changed: true, mismatch: true };
  }

  payment.status = 'paid';
  if (gatewayPaymentId) payment.gatewayPaymentId = gatewayPaymentId;
  payment.instrument = instrument || null;
  payment.rawResponse = raw ?? null;
  await payment.save();

  const order = payment.order ? await Order.findById(payment.order) : null;
  if (order && order.paymentStatus !== 'paid') {
    order.paymentStatus = 'paid';
    await order.save();
    // Paid — now it can go to the pickers (see order.service.js#dispatchToPickers).
    await dispatchToPickers({ order, changedBy: order.customer });
    await notifyUser(order.customer, {
      title: 'Payment received',
      body: `Payment for order ${order.orderNumber} was successful.`,
      type: 'payment_success',
      data: { orderId: order._id },
    });
  }
  return { changed: true };
}

async function markFailed(payment, { gatewayPaymentId, reason, raw }) {
  if (payment.status === 'paid') return { changed: false };
  payment.status = 'failed';
  if (gatewayPaymentId) payment.gatewayPaymentId = gatewayPaymentId;
  payment.failureReason = reason || 'Payment failed';
  payment.rawResponse = raw ?? null;
  await payment.save();

  const order = payment.order ? await Order.findById(payment.order) : null;
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
  return { changed: true };
}

// Unique, gateway-safe transaction id (alphanumeric, ≤ 25 chars — PayU's txnid limit).
function newTransactionId() {
  return `GRV${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

module.exports = { enabledPaymentOptions, customerWebUrl, apiBaseUrl, markPaid, markFailed, newTransactionId };
