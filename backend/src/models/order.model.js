const { Schema, model } = require('mongoose');

const orderItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, default: null },
  variantLabel: { type: String, default: null },
  nameSnapshot: { type: String, required: true },
  price: { type: Number, required: true },
  qty: { type: Number, required: true },
  pickedQty: { type: Number, default: null },
  isAvailable: { type: Boolean, default: true },
  substituteProduct: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  substituteNote: { type: String, default: null },
});

const statusLogSchema = new Schema({
  status: { type: String, required: true },
  changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  note: { type: String, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

const orderSchema = new Schema({
  orderNumber: { type: String, required: true, unique: true },
  customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  address: { type: Schema.Types.ObjectId, ref: 'Address', required: true },
  picker: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  delivery: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  deliveryAcceptedAt: { type: Date, default: null },
  deliveryPin: { type: String, default: null, select: false },
  pickerHandoverAt: { type: Date, default: null },
  arrivedAtPickupAt: { type: Date, default: null },
  arrivedAtDropAt: { type: Date, default: null },
  failureReason: { type: String, default: null },
  items: { type: [orderItemSchema], default: [] },
  statusLogs: { type: [statusLogSchema], default: [] },
  itemTotal: { type: Number, required: true },
  deliveryFee: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  grandTotal: { type: Number, required: true },
  couponCode: { type: String, default: null },
  paymentMethod: { type: String, enum: ['COD', 'RAZORPAY', 'WALLET'], default: 'COD' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  // Only set for paymentMethod === 'COD', by the delivery partner at hand-off (see
  // delivery.controller.js#completeJob): whether the customer paid in physical cash (which the
  // delivery partner now holds and must hand over to the store) or via UPI at the door (already
  // in digital form — no cash to settle). Drives the cash-vs-UPI split in admin COD reconciliation.
  codCollectionMethod: { type: String, enum: ['cash', 'upi'], default: null },
  orderStatus: {
    type: String,
    enum: ['placed', 'accepted', 'rejected', 'picking', 'packed', 'assigned', 'out_for_delivery', 'delivery_failed', 'delivered', 'cancelled', 'returned'],
    default: 'placed',
  },
  cancelReason: { type: String, default: null },
  placedAt: { type: Date, default: Date.now },
  deliveredAt: { type: Date, default: null },
  settled: { type: Boolean, default: false },
  settlementId: { type: Schema.Types.ObjectId, ref: 'Settlement', default: null },
}, { timestamps: true });

// `select: false` on deliveryPin only keeps it out of query results — it does NOT hide a value
// that code has set on an in-memory document (e.g. right after generating it in order.service.js).
// Strip it unconditionally on every serialization so it can never leak through a normal order
// response; the only sanctioned way to read it back is the dedicated customer delivery-pin endpoint,
// which reads `order.deliveryPin` directly off the document rather than through toJSON/toObject.
function stripDeliveryPin(doc, ret) {
  delete ret.deliveryPin;
  return ret;
}
orderSchema.set('toJSON', { transform: stripDeliveryPin });
orderSchema.set('toObject', { transform: stripDeliveryPin });

module.exports = model('Order', orderSchema);
