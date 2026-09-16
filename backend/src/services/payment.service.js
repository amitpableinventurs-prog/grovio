const crypto = require('crypto');
const { getRazorpayInstance } = require('../config/razorpay');
const { Payment, Wallet, WalletTransaction } = require('../models');
const ApiError = require('../utils/apiError');

async function createRazorpayOrder({ order, userId }) {
  const razorpay = getRazorpayInstance();
  if (!razorpay) {
    throw new ApiError(500, 'Razorpay is not configured. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env');
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

function verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const generated = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  return generated === razorpaySignature;
}

function verifyWebhookSignature(rawBody, signature) {
  const generated = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return generated === signature;
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
  verifySignature,
  verifyWebhookSignature,
  creditWallet,
  debitWallet,
};
