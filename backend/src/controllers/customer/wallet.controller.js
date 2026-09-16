const { Wallet, WalletTransaction } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');

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

module.exports = { getWallet, getTransactions };
