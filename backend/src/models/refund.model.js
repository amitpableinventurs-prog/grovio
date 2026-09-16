const { Schema, model } = require('mongoose');

const refundSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null }, // null for COD/wallet-paid orders
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['processed', 'failed'], default: 'processed' },
}, { timestamps: true });

module.exports = model('Refund', refundSchema);
