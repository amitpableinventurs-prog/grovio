const { Schema, model } = require('mongoose');

// An SOS raised from the Picker, Delivery or Customer app (services/sos.service.js). The phone
// itself dials the helpline (112 / 100 / 108 …): emergency numbers can't be called through a
// telephony API. This record is what the ops team acts on: who, where (live while open), on which
// order, and which helplines they dialled.
const pointSchema = new Schema({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  accuracyM: { type: Number, default: null },
  at: { type: Date, default: Date.now },
}, { _id: false });

const sosAlertSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['customer', 'picker', 'delivery'], required: true },
  // What the person tapped first: a helpline key (police, ambulance, …) or 'sos' for the big
  // SOS button. Later helplines dialled on the same alert go to `calls`.
  kind: { type: String, required: true },
  status: { type: String, enum: ['open', 'acknowledged', 'resolved', 'cancelled'], default: 'open' },
  note: { type: String, default: null },
  // First fix, then every update while the alert is open (capped — see sos.service.js).
  location: { type: pointSchema, default: null },
  trail: { type: [pointSchema], default: [] },
  // Context for the ops team: the order they're working on and its hub, if any.
  order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
  calls: [{
    _id: false,
    key: { type: String, required: true },
    number: { type: String, required: true },
    at: { type: Date, default: Date.now },
  }],
  // The person's own emergency contact (picker/delivery profile) and the ops phone, by SMS.
  contactsNotified: [{
    _id: false,
    kind: { type: String, enum: ['emergency_contact', 'ops'], required: true },
    name: { type: String, default: null },
    phone: { type: String, required: true },
    sent: { type: Boolean, default: false },
    reason: { type: String, default: null },
    at: { type: Date, default: Date.now },
  }],
  acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  acknowledgedAt: { type: Date, default: null },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
  resolutionNote: { type: String, default: null },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: null },
}, { timestamps: true });

sosAlertSchema.index({ status: 1, createdAt: -1 });
sosAlertSchema.index({ user: 1, status: 1 });
sosAlertSchema.index({ store: 1, createdAt: -1 });

module.exports = model('SosAlert', sosAlertSchema);
