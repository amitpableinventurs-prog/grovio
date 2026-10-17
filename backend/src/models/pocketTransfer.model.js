const { Schema, model } = require('mongoose');

// Money moving between a delivery partner's pocket (wallet) and outside it — see
// services/pocket.service.js:
//   withdrawal     pocket -> bank, asked for by the partner
//   weekly_payout  pocket -> bank, the positive balance every Monday
//   cash_deposit   COD cash the partner collected, paid back (UPI via Razorpay, or at the hub)
// Bank transfers are carried out by an admin (no payout provider is wired in yet), who moves them
// initiated -> in_process -> completed (with the IMPS/UTR reference) or failed, which puts the
// money back in the pocket.
const pocketTransferSchema = new Schema({
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['withdrawal', 'weekly_payout', 'cash_deposit'], required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['initiated', 'in_process', 'completed', 'failed'], default: 'initiated' },
  initiatedAt: { type: Date, default: Date.now },
  processingAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  failedAt: { type: Date, default: null },
  failureReason: { type: String, default: null },
  // Bank account it was sent to, as it was at the time (payouts only).
  bank: {
    bankName: { type: String, default: null },
    accountHolderName: { type: String, default: null },
    accountNumberLast4: { type: String, default: null },
    ifsc: { type: String, default: null },
  },
  // IMPS / UTR reference of the bank transfer, or the deposit's gateway payment id / receipt no.
  reference: { type: String, default: null },
  // cash_deposit via Razorpay
  method: { type: String, enum: [null, 'razorpay', 'hub'], default: null },
  gatewayOrderId: { type: String, default: null, index: true },
  // weekly_payout: Monday (YYYY-MM-DD) of the week it was created, so it's made once a week.
  weekKey: { type: String, default: null },
  // The rider dismissed the "Failed to transfer amount" popup.
  failureSeenAt: { type: Date, default: null },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

pocketTransferSchema.index({ rider: 1, createdAt: -1 });
pocketTransferSchema.index({ rider: 1, type: 1, weekKey: 1 }, { unique: true, partialFilterExpression: { type: 'weekly_payout' } });

module.exports = model('PocketTransfer', pocketTransferSchema);
