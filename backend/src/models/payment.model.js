const { Schema, model } = require('mongoose');

const paymentSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['COD', 'RAZORPAY', 'WALLET'], required: true },
  // Only set for method === 'COD': how the delivery partner actually collected it at the door.
  collectionMethod: { type: String, enum: ['cash', 'upi'], default: null },
  gatewayOrderId: { type: String, default: null },
  gatewayPaymentId: { type: String, default: null },
  status: { type: String, enum: ['created', 'paid', 'failed', 'refunded'], default: 'created' },
  rawResponse: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true });

module.exports = model('Payment', paymentSchema);
