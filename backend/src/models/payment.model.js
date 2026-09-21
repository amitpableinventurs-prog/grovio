const { Schema, model } = require('mongoose');

const paymentSchema = new Schema({
  // null for purpose 'wallet_topup' — a top-up isn't tied to any order.
  order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  method: { type: String, enum: ['COD', 'RAZORPAY', 'WALLET'], required: true },
  // What this payment is for. Lets order payments and wallet top-ups share one Payment
  // collection (and the same Razorpay create/verify/webhook plumbing) instead of duplicating it.
  purpose: { type: String, enum: ['order', 'wallet_topup'], default: 'order' },
  // Set when this attempt is a retry of an earlier failed one (see wallet.controller.js#retryAddMoney)
  // — each attempt still gets its own Razorpay order, this just links them for traceability.
  retryOf: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
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
