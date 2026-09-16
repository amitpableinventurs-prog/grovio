const { Schema, model } = require('mongoose');

const addressSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  label: { type: String, default: 'Home' },
  line1: { type: String, required: true },
  landmark: { type: String, default: null },
  city: { type: String, default: null },
  state: { type: String, default: null },
  pincode: { type: String, default: null },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  isDefault: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = model('Address', addressSchema);
