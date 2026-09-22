const { Schema, model } = require('mongoose');

const orderItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  // Which store this item is actually picked from. Snapshotted at order creation, same as
  // nameSnapshot/price below — an order can hold items from multiple stores (see order.store,
  // the hub they all consolidate into) so this is what routes picking to the right store's
  // pickers; see assignment.service.js#splitOrderAcrossPickers.
  pickupStore: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  variantId: { type: Schema.Types.ObjectId, default: null },
  variantLabel: { type: String, default: null },
  nameSnapshot: { type: String, required: true },
  price: { type: Number, required: true },
  qty: { type: Number, required: true },
  pickedQty: { type: Number, default: null },
  // When the order is split across pickTasks (see below), this is which picker is responsible
  // for this specific item. Set when the order is accepted (see assignment.service.js#splitItemsAcrossPickers).
  assignedPicker: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  // Set when the assigned picker successfully scans this item's product QR — see
  // picker/picker.controller.js#scanItem. Distinct from pickedQty being non-null: pickedQty could
  // in principle be set without a scan (e.g. old data, or a manual override), pickedAt specifically
  // marks a verified scan.
  pickedAt: { type: Date, default: null },
  isAvailable: { type: Boolean, default: true },
  substituteProduct: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  substituteNote: { type: String, default: null },
});

// One entry per picker working this order — an order is split across up to 3 pickers PER STORE
// represented in it, who work their portion (the items whose orderItem.assignedPicker matches
// them) in parallel. Replaces the old single `picker` field.
const pickTaskSchema = new Schema({
  picker: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // Which store this picker is working at. When it differs from order.store (the hub store this
  // order consolidates at), their portion isn't done until it physically reaches the hub — see
  // handoffStatus below.
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  status: { type: String, enum: ['assigned', 'picking', 'completed'], default: 'assigned' },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  // 'not_required' for the hub store's own picker (nothing to carry anywhere). Otherwise starts
  // 'pending' and becomes 'delivered_to_hub' once the hub-store picker scan-verifies the OTP this
  // picker shows them in person — see order.service.js#verifyHandoffOtp. The order can't reach
  // 'packed' (ready for the single delivery-partner pickup) until every task here is either
  // 'not_required' or 'delivered_to_hub'.
  handoffStatus: { type: String, enum: ['not_required', 'pending', 'delivered_to_hub'], default: 'not_required' },
  handoffOtp: { type: String, default: null, select: false },
  handoffOtpExpiresAt: { type: Date, default: null, select: false },
  handoffOtpAttempts: { type: Number, default: 0, select: false },
  handoffAt: { type: Date, default: null },
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
  // Up to 3 pickers working this order in parallel, each responsible for the items whose
  // orderItem.assignedPicker matches them — see pickTaskSchema above.
  pickTasks: { type: [pickTaskSchema], default: [] },
  delivery: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  deliveryAcceptedAt: { type: Date, default: null },
  deliveryPin: { type: String, default: null, select: false },
  // Picker <-> Delivery Boy handover OTP (distinct from deliveryPin above, which is the
  // Delivery Boy <-> Customer PIN at drop-off). Auto-generated alongside deliveryPin as soon as
  // a delivery partner is assigned (see order.service.js#transitionOrder); the Picker reads it
  // out to the Delivery Boy in person, who submits it via POST /delivery/jobs/:id/otp/verify.
  // This is the only path allowed to move an order into 'picked_up' — see
  // delivery.controller.js#verifyHandoverOtp.
  handoverOtp: { type: String, default: null, select: false },
  handoverOtpExpiresAt: { type: Date, default: null, select: false },
  handoverOtpAttempts: { type: Number, default: 0, select: false },
  // Alternative to handoverOtp above — either one completes the same Picker->Delivery handover.
  // The Picker's app displays this as a QR code (see GET /picker/jobs/:id/qr); the Delivery Boy
  // scans it and submits the decoded token via POST /delivery/jobs/:id/scan. Every scan attempt,
  // successful or not, is recorded in ScannerLog regardless of which method completes the handover.
  handoverQrToken: { type: String, default: null, select: false },
  handoverQrTokenExpiresAt: { type: Date, default: null, select: false },
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
    enum: ['placed', 'accepted', 'rejected', 'picking', 'partially_picked', 'packed', 'assigned', 'picked_up', 'out_for_delivery', 'delivery_failed', 'delivered', 'cancelled', 'returned'],
    default: 'placed',
  },
  cancelReason: { type: String, default: null },
  placedAt: { type: Date, default: Date.now },
  deliveredAt: { type: Date, default: null },
  settled: { type: Boolean, default: false },
  settlementId: { type: Schema.Types.ObjectId, ref: 'Settlement', default: null },
}, { timestamps: true });

// `select: false` on these fields only keeps them out of query results — it does NOT hide a value
// that code has set on an in-memory document (e.g. right after generating it in order.service.js).
// Strip them unconditionally on every serialization so they can never leak through a normal order
// response; the only sanctioned ways to read them back are the dedicated endpoints that select
// them explicitly (customer delivery-pin endpoint, picker handover-OTP endpoint).
function stripSensitiveFields(doc, ret) {
  delete ret.deliveryPin;
  delete ret.handoverOtp;
  delete ret.handoverOtpExpiresAt;
  delete ret.handoverOtpAttempts;
  delete ret.handoverQrToken;
  delete ret.handoverQrTokenExpiresAt;
  ret.pickTasks?.forEach((task) => {
    delete task.handoffOtp;
    delete task.handoffOtpExpiresAt;
    delete task.handoffOtpAttempts;
  });
  return ret;
}
orderSchema.set('toJSON', { transform: stripSensitiveFields });
orderSchema.set('toObject', { transform: stripSensitiveFields });

module.exports = model('Order', orderSchema);
