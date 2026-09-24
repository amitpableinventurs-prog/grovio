const { Schema, model } = require('mongoose');

const deliveryProfileSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  vehicleType: { type: String, default: null },
  vehicleNumber: { type: String, default: null },
  licenseNumber: { type: String, default: null },
  status: { type: String, enum: ['pending', 'approved', 'blocked'], default: 'pending' },
  isAvailable: { type: Boolean, default: false },
  currentLat: { type: Number, default: null },
  currentLng: { type: Number, default: null },
  // When currentLat/currentLng were last reported — a stale fix isn't used for ETA/tracking
  // (see services/tracking.service.js).
  locationUpdatedAt: { type: Date, default: null },
  // Set by scanning a Hub Center screen's check-in QR (POST /delivery/hub/checkin) — proof the
  // partner is physically at that hub, required to see/claim its ready orders under
  // /delivery/hub/*. Expires after HUB_CHECKIN_MINUTES; see services/hubDisplay.service.js.
  hubCheckin: {
    store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
    display: { type: Schema.Types.ObjectId, ref: 'HubDisplay', default: null },
    at: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
}, { timestamps: true });

module.exports = model('DeliveryProfile', deliveryProfileSchema);
