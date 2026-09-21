const { Schema, model } = require('mongoose');

const paymentSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['COD', 'RAZORPAY', 'WALLET'], required: true },
  // Only set for method === 'COD': how the delivery partner actually collected it at the door.
  collectionMethod: { type: String, enum: ['cash', 'upi'], default: null },
  // Only set for method === 'RAZORPAY': the actual instrument Razorpay reports the customer paid
  // with (card/upi/netbanking/wallet/emi), fetched on verify and again on the webhook — Razorpay
  // itself is the gateway, this is what the customer picked inside its checkout widget.
  instrument: { type: String, enum: ['card', 'upi', 'netbanking', 'wallet', 'emi'], default: null },
  gatewayOrderId: { type: String, default: null },
  gatewayPaymentId: { type: String, default: null },
  status: { type: String, enum: ['created', 'paid', 'failed', 'refunded'], default: 'created' },
  failureReason: { type: String, default: null },
  rawResponse: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true });

module.exports = model('Payment', paymentSchema);
