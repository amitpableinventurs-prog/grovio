const { Schema, model } = require('mongoose');

const walletTransactionSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  refOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  // Delivery partner pocket entries (services/pocket.service.js). Earnings (Earnings screen):
  // order_earning, incentive, other_earning. Money moving in and out of the pocket: cash_collected
  // (COD cash the partner now holds, a debit), cash_deposit (handing it back), withdrawal /
  // payout (to the bank) and their *_reversal when a transfer fails, and deduction (penalties).
  // null for everything else (customers' wallets). Older 'Delivery earning' credits have no
  // category and are read as order_earning.
  category: {
    type: String,
    enum: [null, 'order_earning', 'incentive', 'other_earning', 'cash_collected', 'cash_deposit', 'withdrawal', 'withdrawal_reversal', 'payout', 'payout_reversal', 'deduction'],
    default: null,
  },
  // Shown instead of the category's default title, e.g. a deduction's "Temp Manual Pay".
  title: { type: String, default: null },
  // Second line, e.g. "Cold Bag Fraud 27th Jan".
  description: { type: String, default: null },
  refOfferId: { type: Schema.Types.ObjectId, ref: 'IncentiveOffer', default: null },
  refTransferId: { type: Schema.Types.ObjectId, ref: 'PocketTransfer', default: null },
  // External reference: gateway payment id, deposit receipt no.
  refId: { type: String, default: null },
  balanceAfter: { type: Number, required: true },
}, { timestamps: true });

walletTransactionSchema.index({ user: 1, category: 1, createdAt: -1 });

module.exports = model('WalletTransaction', walletTransactionSchema);
