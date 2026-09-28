const { Schema, model } = require('mongoose');

// A company-owned outlet, created and managed directly by Admin (no vendor/owner login).
// Products, inventory, pickers and orders are all scoped to a specific store.
const storeSchema = new Schema({
  name: { type: String, required: true },
  logo: { type: String, default: null },
  banner: { type: String, default: null },
  description: { type: String, default: null },
  address: { type: String, default: null },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  zoneId: { type: String, default: null },
  // Delivery area: addresses farther than this (straight-line km) from the store can't order from
  // it. null = use the defaultServiceRadiusKm setting (blank = no limit). See tracking.service.js.
  serviceRadiusKm: { type: Number, default: null, min: 0 },
  openTime: { type: String, default: null },
  closeTime: { type: String, default: null },
  isOpen: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  // Picker pay rates for this store: only what differs from the default policy
  // (services/pickerPay.service.js). A picker's own rates override these.
  pickerPayPolicy: { type: Schema.Types.Mixed, default: null },
  // Weather / surge at this hub for delivery partner pay (services/riderPay.service.js), set by an
  // admin: rain none|normal|heavy|severe, surge none|high; applies to deliveries in [since, until).
  riderConditions: {
    type: new Schema({
      rain: { type: String, enum: ['none', 'normal', 'heavy', 'severe'], default: 'none' },
      surge: { type: String, enum: ['none', 'high'], default: 'none' },
      since: { type: Date, default: null },
      until: { type: Date, default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      updatedAt: { type: Date, default: null },
    }, { _id: false }),
    default: null,
  },
}, { timestamps: true });

module.exports = model('Store', storeSchema);
