const crypto = require('crypto');
const { getRazorpayInstance } = require('../config/razorpay');
const { getSetting } = require('./settings.service');
const { Payment, Wallet, WalletTransaction } = require('../models');
const ApiError = require('../utils/apiError');

// The Razorpay Node SDK rejects with a plain object — { statusCode, error: { code, description,
// ... } } — not an Error instance, so it has no .message and no useful default status. Left
// unwrapped, error.middleware.js's generic handler was destructuring `statusCode` straight off
// of it (e.g. Razorpay's own 401 "invalid credentials") and returning THAT as our HTTP status
// with a blank message, which read exactly like OUR auth had failed rather than Razorpay
// rejecting our stored API key/secret. Always route Razorpay SDK failures through this so callers
// get a real ApiError with an honest, non-misleading message instead.
function translateRazorpayError(err, context) {
  if (err instanceof ApiError) return err;
  const description = err?.error?.description;
  if (err?.statusCode === 401) {
    return new ApiError(502, 'Payment gateway rejected our API credentials. Check the Razorpay key/secret in Admin > Settings > Integrations.');
  }
  return new ApiError(502, description ? `Payment gateway error: ${description}` : `Payment gateway error while ${context}`);
}

async function createRazorpayOrder({ order, userId }) {
  const razorpay = await getRazorpayInstance();
  if (!razorpay) {
    throw new ApiError(500, 'Razorpay is not configured. Set it up in Admin > Settings > Integrations, or RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env');
  }

  const amountInPaise = Math.round(Number(order.grandTotal) * 100);
  let rzpOrder;
  try {
    rzpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: order.orderNumber,
      // Explicit manual capture rather than relying on the Razorpay account's dashboard-level
      // auto-capture setting (which this codebase has no visibility into and could be toggled
      // independently). We capture ourselves on the payment.authorized webhook below, after
      // re-validating the amount server-side — see capturePayment().
      payment_capture: 0,
    });
  } catch (err) {
    throw translateRazorpayError(err, 'creating the order');
  }

  const payment = await Payment.create({
    order: order._id,
    user: userId,
    amount: order.grandTotal,
    method: 'RAZORPAY',
    gatewayOrderId: rzpOrder.id,
    status: 'created',
  });

  return { razorpayOrder: rzpOrder, payment };
}

// Same idea as createRazorpayOrder above, but for a wallet top-up rather than an existing Order —
// there's no order to attach the Payment record to, and the receipt just needs to be unique.
async function createWalletTopupOrder({ userId, amount, retryOf = null }) {
  const razorpay = await getRazorpayInstance();
  if (!razorpay) {
    throw new ApiError(500, 'Razorpay is not configured. Set it up in Admin > Settings > Integrations, or RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env');
  }

  const amountInPaise = Math.round(Number(amount) * 100);
  let rzpOrder;
  try {
    rzpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `wallet-${userId}-${Date.now()}`,
      payment_capture: 0, // see the matching comment in createRazorpayOrder above
    });
  } catch (err) {
    throw translateRazorpayError(err, 'creating the top-up order');
  }

  const payment = await Payment.create({
    user: userId,
    amount,
    method: 'RAZORPAY',
    purpose: 'wallet_topup',
    gatewayOrderId: rzpOrder.id,
    status: 'created',
    retryOf,
  });

  return { razorpayOrder: rzpOrder, payment };
}

async function verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const keySecret = await getSetting('razorpayKeySecret', 'RAZORPAY_KEY_SECRET');
  if (!keySecret) throw new ApiError(500, 'Razorpay is not configured');
  const generated = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return generated === razorpaySignature;
}

async function verifyWebhookSignature(rawBody, signature) {
  const webhookSecret = await getSetting('razorpayWebhookSecret', 'RAZORPAY_WEBHOOK_SECRET');
  if (!webhookSecret) return false;
  const generated = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  return generated === signature;
}

// Called from the payment.authorized webhook handler, after re-checking the authorized amount
// against what we actually expected — orders are created with payment_capture: 0, so nothing is
// captured until this runs. Razorpay follows a successful capture with its own payment.captured
// webhook, which is what actually marks the Payment/Order/Wallet paid — this function only moves
// the money from "authorized" to "captured" on Razorpay's side.
async function capturePayment(razorpayPaymentId, amountInPaise, currency = 'INR') {
  const razorpay = await getRazorpayInstance();
  if (!razorpay) throw new ApiError(500, 'Razorpay is not configured');
  try {
    return await razorpay.payments.capture(razorpayPaymentId, amountInPaise, currency);
  } catch (err) {
    throw translateRazorpayError(err, 'capturing the payment');
  }
}

// Razorpay's checkout widget is what actually lets the customer pick card/UPI/netbanking/etc —
// the only way to know which one they used is to ask Razorpay after the fact.
async function fetchPaymentInstrument(razorpayPaymentId) {
  try {
    const razorpay = await getRazorpayInstance();
    if (!razorpay) return null;
    const entity = await razorpay.payments.fetch(razorpayPaymentId);
    return entity?.method || null;
  } catch (err) {
    return null;
  }
}

async function creditWallet({ userId, amount, reason, refOrderId = null }) {
  let wallet = await Wallet.findOne({ user: userId });
  if (!wallet) wallet = await Wallet.create({ user: userId, balance: 0 });

  const newBalance = Number(wallet.balance) + Number(amount);
  wallet.balance = newBalance;
  await wallet.save();

  await WalletTransaction.create({
    user: userId,
    type: 'credit',
    amount,
    reason,
    refOrderId,
    balanceAfter: newBalance,
  });

  return wallet;
}

async function debitWallet({ userId, amount, reason, refOrderId = null }) {
  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet || Number(wallet.balance) < Number(amount)) {
    throw new ApiError(400, 'Insufficient wallet balance');
  }

  const newBalance = Number(wallet.balance) - Number(amount);
  wallet.balance = newBalance;
  await wallet.save();

  await WalletTransaction.create({
    user: userId,
    type: 'debit',
    amount,
    reason,
    refOrderId,
    balanceAfter: newBalance,
  });

  return wallet;
}

module.exports = {
  createRazorpayOrder,
  createWalletTopupOrder,
  capturePayment,
  verifySignature,
  verifyWebhookSignature,
  fetchPaymentInstrument,
  creditWallet,
  debitWallet,
};
