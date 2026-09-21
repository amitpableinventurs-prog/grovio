const crypto = require('crypto');
const { getRazorpayInstance } = require('../config/razorpay');
const { getSetting } = require('./settings.service');
const { Payment, Wallet, WalletTransaction } = require('../models');
const ApiError = require('../utils/apiError');

async function createRazorpayOrder({ order, userId }) {
  const razorpay = await getRazorpayInstance();
  if (!razorpay) {
    throw new ApiError(500, 'Razorpay is not configured. Set it up in Admin > Settings > Integrations, or RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env');
  }

  const amountInPaise = Math.round(Number(order.grandTotal) * 100);
  const rzpOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: order.orderNumber,
  });

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
  const rzpOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: `wallet-${userId}-${Date.now()}`,
  });

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
  verifySignature,
  verifyWebhookSignature,
  fetchPaymentInstrument,
  creditWallet,
  debitWallet,
};
