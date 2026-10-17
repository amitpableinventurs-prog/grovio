const crypto = require('crypto');
const { Payment } = require('../../models');
const { getSetting } = require('../settings.service');
const ApiError = require('../../utils/apiError');
const { newTransactionId, markPaid, markFailed } = require('./index');

// PayU hosted checkout (India). Flow:
//   1. POST /payments/payu/create -> we return PayU's form URL + signed fields; the customer web
//      app auto-submits that form, so the customer lands on PayU's payment page.
//   2. PayU POSTs the result to our surl/furl (POST /payments/payu/callback). We verify PayU's
//      reverse hash + amount, mark the order paid/failed, and redirect the browser back to the
//      customer web app's /payment/return page.
//   PayU's server-to-server webhook (POST /payments/payu/webhook) carries the same fields and is
//   handled the same way, for customers who close the tab before the redirect.

const URLS = { test: 'https://test.payu.in/_payment', live: 'https://secure.payu.in/_payment' };
const sha512 = (s) => crypto.createHash('sha512').update(s).digest('hex');

async function payuConfig() {
  const key = await getSetting('payuKey', 'PAYU_KEY');
  const salt = await getSetting('payuSalt', 'PAYU_SALT');
  const mode = (await getSetting('payuMode', 'PAYU_MODE')) === 'live' ? 'live' : 'test';
  if (!key || !salt) throw new ApiError(500, 'PayU is not configured. Set the merchant key and salt in Admin > Settings > Payments.');
  return { key, salt, mode, action: process.env.PAYU_PAYMENT_URL || URLS[mode] };
}

// key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT
function requestHash(f, salt) {
  return sha512([f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email, f.udf1 || '', f.udf2 || '', f.udf3 || '', f.udf4 || '', f.udf5 || '', '', '', '', '', '', salt].join('|'));
}

// [additionalCharges|]SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
function responseHash(r, salt) {
  const parts = [salt, r.status, '', '', '', '', '', r.udf5 || '', r.udf4 || '', r.udf3 || '', r.udf2 || '', r.udf1 || '', r.email, r.firstname, r.productinfo, r.amount, r.txnid, r.key];
  if (r.additionalCharges) parts.unshift(r.additionalCharges);
  return sha512(parts.join('|'));
}

async function createPayment({ order, user, callbackUrl }) {
  const cfg = await payuConfig();
  const fields = {
    key: cfg.key,
    txnid: newTransactionId(),
    amount: Number(order.grandTotal).toFixed(2),
    productinfo: `Grovio order ${order.orderNumber}`,
    firstname: (user.name || 'Customer').replace(/[^\w .-]/g, '').slice(0, 60) || 'Customer',
    email: user.email || 'orders@grovio.in',
    phone: user.phone || '',
    surl: callbackUrl,
    furl: callbackUrl,
    udf1: order._id.toString(),
  };
  fields.hash = requestHash(fields, cfg.salt);

  await Payment.create({
    order: order._id,
    user: user._id,
    amount: order.grandTotal,
    method: 'PAYU',
    gatewayOrderId: fields.txnid,
    status: 'created',
  });

  return { action: cfg.action, fields };
}

const INSTRUMENTS = { CC: 'card', DC: 'card', CREDITCARD: 'card', DEBITCARD: 'card', NB: 'netbanking', UPI: 'upi', CASH: 'wallet', WALLET: 'wallet', EMI: 'emi' };

// Handles PayU's result (browser callback or webhook). Returns { payment, status } where status
// is 'paid' | 'failed' | 'invalid'.
async function handleResponse(body) {
  const cfg = await payuConfig();
  const expected = responseHash(body, cfg.salt);
  const given = String(body.hash || '');
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected)) || body.key !== cfg.key) {
    return { status: 'invalid' };
  }

  const payment = await Payment.findOne({ method: 'PAYU', gatewayOrderId: body.txnid });
  if (!payment) return { status: 'invalid' };

  if (String(body.status).toLowerCase() === 'success') {
    const result = await markPaid(payment, {
      gatewayPaymentId: body.mihpayid,
      instrument: INSTRUMENTS[String(body.mode || '').toUpperCase()] || null,
      amount: body.amount,
      raw: body,
    });
    return { payment, status: result.mismatch ? 'failed' : 'paid' };
  }
  await markFailed(payment, { gatewayPaymentId: body.mihpayid, reason: body.error_Message || body.field9 || `PayU status: ${body.status}`, raw: body });
  return { payment, status: payment.status === 'paid' ? 'paid' : 'failed' };
}

module.exports = { createPayment, handleResponse, requestHash, responseHash };
