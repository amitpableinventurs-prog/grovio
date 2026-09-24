const { Schema, model } = require('mongoose');

const orderItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  // Which store this item is actually picked from. Snapshotted at order creation, same as
  // nameSnapshot/price below — an order can hold items from multiple stores; order.store (the
  // Hub Center) is where they all end up before the delivery partner collects the whole order in
  // one pickup — see pickTaskSchema below.
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
  isAvailable: { type: Boolean, default: true },
  substituteProduct: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  substituteNote: { type: String, default: null },
});

// One entry per picker working this order — an order is split across up to 3 pickers PER STORE
// represented in it, who each pick + pack their own portion at their own store (no scanning) and
// press "Ready for Pickup" when done (status: 'completed' below). order.store is the Hub Center —
// non-hub pickers get their picked items there themselves (picker-to-picker coordination, not
// tracked by the app); the delivery partner only ever visits the hub and does ONE pickup for the
// whole order (see delivery.controller.js#verifyHandoverOtpCtrl/scanHandoverQr). Replaces the old
// single `picker` field.
const pickTaskSchema = new Schema({
  picker: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // Which store this picker is working at.
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  // 'completed' here means picked + packed + the picker pressed "Ready for Pickup" — there is no
  // scan-verified picking step.
  status: { type: String, enum: ['assigned', 'picking', 'completed'], default: 'assigned' },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
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
  // Picker <-> Delivery Boy handover OTP for the single pickup at the hub (order.store). Auto-
  // generated as soon as a delivery partner is assigned (see order.service.js#transitionOrder);
  // the hub picker reads it out to the Delivery Boy in person, who submits it via
  // POST /delivery/jobs/:id/otp/verify. This is the only path allowed to move an order into
  // 'picked_up' — see delivery.controller.js#verifyHandoverOtp.
  handoverOtp: { type: String, default: null, select: false },
  handoverOtpExpiresAt: { type: Date, default: null, select: false },
  handoverOtpAttempts: { type: Number, default: 0, select: false },
  // Alternative to handoverOtp above — either one completes the same Picker->Delivery handover.
  // The hub picker's app displays this as a QR code (see GET /picker/jobs/:id/qr); the Delivery
  // Boy scans it and submits the decoded token via POST /delivery/jobs/:id/scan. Every scan
  // attempt, successful or not, is recorded in ScannerLog regardless of which method completes it.
  handoverQrToken: { type: String, default: null, select: false },
  handoverQrTokenExpiresAt: { type: Date, default: null, select: false },
  pickerHandoverAt: { type: Date, default: null },
  arrivedAtPickupAt: { type: Date, default: null },
  arrivedAtDropAt: { type: Date, default: null },
  // Set the first time the delivery partner comes within TRACKING_NEARBY_KM of the drop address
  // (geofence in services/tracking.service.js) — the customer's "almost there" alert fires once.
  nearbyAlertAt: { type: Date, default: null },
  failureReason: { type: String, default: null },
  items: { type: [orderItemSchema], default: [] },
  statusLogs: { type: [statusLogSchema], default: [] },
  itemTotal: { type: Number, required: true },
  deliveryFee: { type: Number, default: 0 },
  // Admin-configured charges snapshotted at checkout (see services/charges.service.js). Old orders
  // simply read 0 / null for these.
  handlingCharge: { type: Number, default: 0 },
  packingCharge: { type: Number, default: 0 },
  surcharge: { type: Number, default: 0 },
  surchargeLabel: { type: String, default: null },
  // What the delivery partner is paid for this order — the delivery charge before any
  // free-delivery waiver, so a free-delivery order still pays the rider. null on orders placed
  // before this field existed; delivery.controller.js#completeJob falls back to deliveryFee.
  deliveryPartnerEarning: { type: Number, default: null },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  grandTotal: { type: Number, required: true },
  couponCode: { type: String, default: null },
  paymentMethod: { type: String, enum: ['COD', 'RAZORPAY', 'WALLET', 'PAYU', 'PHONEPE'], default: 'COD' },
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
  // COD confirmation call (services/ivr.service.js#requestOrderConfirmation): null = no call made.
  ivrConfirmation: { type: String, enum: [null, 'pending', 'confirmed', 'declined', 'no_answer'], default: null },
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
  return ret;
}
orderSchema.set('toJSON', { transform: stripSensitiveFields });
orderSchema.set('toObject', { transform: stripSensitiveFields });

// Real-time feed — every save is pushed to connected clients (see sockets/orderEvents.js).
// Required lazily: sockets/ loads models, so a top-level require here would be circular.
// Note this only fires for document saves (order.save() / Order.create()); a bulk
// Order.updateOne()/updateMany() would bypass it and needs its own publishOrderChange() call.
const orderEvents = () => require('../sockets/orderEvents');

// Snapshot who could see the order as loaded, so parties removed by this save (e.g. a delivery
// partner rejecting the job) still get the update.
orderSchema.post('init', function snapshotRooms() {
  this.$locals.loadedRooms = orderEvents().roomsFor(this);
});
orderSchema.pre('save', function markChange() {
  this.$locals.wasNew = this.isNew;
  this.$locals.hadChanges = this.isNew || this.modifiedPaths().length > 0;
});
orderSchema.post('save', function publishChange(doc) {
  if (!doc.$locals.hadChanges) return;
  orderEvents().publishOrderChange(doc, { created: doc.$locals.wasNew, previousRooms: doc.$locals.loadedRooms || [] });
  doc.$locals.loadedRooms = orderEvents().roomsFor(doc);
});

module.exports = model('Order', orderSchema);
