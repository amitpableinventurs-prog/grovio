const { Schema, model } = require('mongoose');

// One run by a delivery partner: every order they collect at a hub before leaving it (a
// "MULTI ORDER" trip when there's more than one). Orders join while the trip is 'open' (at the
// hub); it 'started' when the first order goes out for delivery; it's 'completed' once every order
// is delivered / cancelled / failed / returned — and then it's paid, once (services/riderPay.service.js).
const payLineSchema = new Schema({
  key: { type: String, required: true }, // order_pay | peak_pay | rain_pay | heavy_load_pay | waiting_pay | cancellation_pay
  label: { type: String, required: true },
  amount: { type: Number, required: true },
}, { _id: false });

const deliveryTripSchema = new Schema({
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  orders: { type: [{ type: Schema.Types.ObjectId, ref: 'Order' }], default: [] },
  status: { type: String, enum: ['open', 'started', 'completed'], default: 'open' },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  // Set when completed and paid.
  pay: {
    total: { type: Number, default: 0 },
    // Sums of the orders' pay (each order is paid for its own distance — see Order.riderPay).
    lines: { type: [payLineSchema], default: [] },
    // Total mapped km of the delivered orders.
    distanceKm: { type: Number, default: null },
    deliveredOrders: { type: Number, default: 0 },
    // Whose rates were used: 'default' or 'partner' (their own pay).
    rates: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
}, { timestamps: true });

deliveryTripSchema.index({ rider: 1, status: 1 });
deliveryTripSchema.index({ rider: 1, completedAt: -1 });

module.exports = model('DeliveryTrip', deliveryTripSchema);
