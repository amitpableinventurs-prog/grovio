const { Schema, model } = require('mongoose');

// One time a cold bag went out with a delivery partner: taken at pickup (with the orders it
// carried), returned at a store — or not (overdue -> admin can mark it lost and deduct).
const coldBagIssueSchema = new Schema({
  bag: { type: Schema.Types.ObjectId, ref: 'ColdBag', required: true },
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  orders: { type: [{ type: Schema.Types.ObjectId, ref: 'Order' }], default: [] },
  issuedAt: { type: Date, default: Date.now },
  dueAt: { type: Date, required: true },
  status: { type: String, enum: ['issued', 'returned', 'lost'], default: 'issued' },
  returnedAt: { type: Date, default: null },
  returnedStore: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
  // Deduction made for not returning it.
  penaltyTxn: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
}, { timestamps: true });

coldBagIssueSchema.index({ rider: 1, status: 1 });
coldBagIssueSchema.index({ status: 1, dueAt: 1 });

module.exports = model('ColdBagIssue', coldBagIssueSchema);
