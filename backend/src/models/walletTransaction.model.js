const { Schema, model } = require('mongoose');

const walletTransactionSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  refOrderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  balanceAfter: { type: Number, required: true },
}, { timestamps: true });

module.exports = model('WalletTransaction', walletTransactionSchema);
