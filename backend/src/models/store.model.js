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
  openTime: { type: String, default: null },
  closeTime: { type: String, default: null },
  isOpen: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });

module.exports = model('Store', storeSchema);
