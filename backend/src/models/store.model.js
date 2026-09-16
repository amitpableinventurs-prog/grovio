const { Schema, model } = require('mongoose');

// A physical outlet belonging to a Vendor. A vendor can run multiple stores;
// products, inventory, pickers and orders are all scoped to a specific store.
const storeSchema = new Schema({
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
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
