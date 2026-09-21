const { Wallet, WalletTransaction, Payment } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const paymentService = require('../../services/payment.service');
const { getSetting } = require('../../services/settings.service');

const MIN_ADD_MONEY = 10;
const MAX_ADD_MONEY = 50000;

const getWallet = catchAsync(async (req, res) => {
  let wallet = await Wallet.findOne({ user: req.user.id });
  if (!wallet) wallet = await Wallet.create({ user: req.user.id, balance: 0 });
  new ApiResponse(200, { balance: wallet.balance }).send(res);
});

const getTransactions = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const [rows, count] = await Promise.all([
    WalletTransaction.find({ user: req.user.id }).sort({ createdAt: -1 }).skip(offset).limit(limit),
    WalletTransaction.countDocuments({ user: req.user.id }),
  ]);
  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /customer/wallet/transactions/:id
const getTransactionDetail = catchAsync(async (req, res) => {
  const transaction = await WalletTransaction.findOne({ _id: req.params.id, user: req.user.id });
  if (!transaction) throw new ApiError(404, 'Transaction not found');
  new ApiResponse(200, transaction).send(res);
});

// POST /customer/wallet/add-money/create  { amount }
const createAddMoney = catchAsync(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!amount || amount < MIN_ADD_MONEY || amount > MAX_ADD_MONEY) {
    throw new ApiError(400, `amount must be between ${MIN_ADD_MONEY} and ${MAX_ADD_MONEY}`);
  }

  const { razorpayOrder, payment } = await paymentService.createWalletTopupOrder({ userId: req.user.id, amount });

  new ApiResponse(200, {
    paymentId: payment._id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: await getSetting('razorpayKeyId', 'RAZORPAY_KEY_ID'),
  }, 'Add-money order created').send(res);
});

// POST /customer/wallet/add-money/verify { razorpayOrderId, razorpayPaymentId, razorpaySignature }
const verifyAddMoney = catchAsync(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

  const payment = await Payment.findOne({ gatewayOrderId: razorpayOrderId, user: req.user.id, purpose: 'wallet_topup' });
  if (!payment) throw new ApiError(404, 'Add-money payment not found');

  // Idempotent — the payment.captured webhook may have already processed this by the time the
  // client's own verify call lands (whichever gets there first wins; the other is a no-op).
  if (payment.status === 'paid') {
    const wallet = await Wallet.findOne({ user: req.user.id });
    return new ApiResponse(200, { payment, balance: wallet?.balance ?? 0 }, 'Payment already verified').send(res);
  }

  const valid = await paymentService.verifySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature });
  if (!valid) throw new ApiError(400, 'Payment signature verification failed');

  payment.status = 'paid';
  payment.gatewayPaymentId = razorpayPaymentId;
  payment.instrument = await paymentService.fetchPaymentInstrument(razorpayPaymentId);
  await payment.save();

  const wallet = await paymentService.creditWallet({ userId: req.user.id, amount: payment.amount, reason: 'Wallet top-up' });

  new ApiResponse(200, { payment, balance: wallet.balance }, 'Money added to wallet').send(res);
});

// POST /customer/wallet/add-money/:id/retry — :id is the earlier (failed/stale) Payment's ID.
// Razorpay orders are single-attempt, so this creates a fresh one rather than reusing the old ID.
const retryAddMoney = catchAsync(async (req, res) => {
  const original = await Payment.findOne({ _id: req.params.id, user: req.user.id, purpose: 'wallet_topup' });
  if (!original) throw new ApiError(404, 'Add-money payment not found');
  if (original.status === 'paid') throw new ApiError(400, 'This payment already succeeded');

  const { razorpayOrder, payment } = await paymentService.createWalletTopupOrder({
    userId: req.user.id,
    amount: original.amount,
    retryOf: original._id,
  });

  new ApiResponse(200, {
    paymentId: payment._id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: await getSetting('razorpayKeyId', 'RAZORPAY_KEY_ID'),
  }, 'Add-money order created').send(res);
});

// GET /customer/wallet/add-money/:id/status
const getAddMoneyStatus = catchAsync(async (req, res) => {
  const payment = await Payment.findOne({ _id: req.params.id, user: req.user.id, purpose: 'wallet_topup' });
  if (!payment) throw new ApiError(404, 'Add-money payment not found');
  new ApiResponse(200, { status: payment.status, amount: payment.amount, failureReason: payment.failureReason }).send(res);
});

module.exports = {
  getWallet,
  getTransactions,
  getTransactionDetail,
  createAddMoney,
  verifyAddMoney,
  retryAddMoney,
  getAddMoneyStatus,
};
