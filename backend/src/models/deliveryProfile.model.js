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
}, { timestamps: true });

module.exports = model('DeliveryProfile', deliveryProfileSchema);
