const { Schema, model } = require('mongoose');

// A picking mistake on an order (services/pickerPay.service.js). Reported by a store manager /
// support, then confirmed (fine deducted from the picker's pocket, and that order's speed bonus
// taken back) or waived. Genuine stock-outs and customer cancellations are never errors.
const pickerErrorSchema = new Schema({
  picker: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
  type: { type: String, enum: ['wrong_product', 'missing_product', 'wrong_quantity', 'damaged'], required: true },
  // Items affected — lowers the day's accuracy.
  quantity: { type: Number, default: 1 },
  // Fine; within the policy's range for the type (damaged ₹10–30 after verification).
  amount: { type: Number, default: null },
  note: { type: String, default: null },
  status: { type: String, enum: ['reported', 'confirmed', 'waived'], default: 'reported' },
  reportedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  // When the order's task was completed (which day's accuracy it counts against).
  pickedAt: { type: Date, default: null },
  fineTxn: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
  speedReversalTxn: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
}, { timestamps: true });

pickerErrorSchema.index({ order: 1, picker: 1, type: 1 });

module.exports = model('PickerError', pickerErrorSchema);
