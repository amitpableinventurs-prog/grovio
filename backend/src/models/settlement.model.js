const { Schema, model } = require('mongoose');

const settlementSchema = new Schema({
  payeeRole: { type: String, enum: ['vendor', 'picker', 'delivery'], required: true },
  payeeUser: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // the person/account being paid out
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null }, // set when payeeRole === 'vendor'
  periodFrom: { type: Date, required: true },
  periodTo: { type: Date, required: true },
  orderCount: { type: Number, default: 0 },
  grossAmount: { type: Number, required: true },
  commissionAmount: { type: Number, default: 0 },
  payoutAmount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending' },
  paidAt: { type: Date, default: null },
  note: { type: String, default: null },
}, { timestamps: true });

module.exports = model('Settlement', settlementSchema);
