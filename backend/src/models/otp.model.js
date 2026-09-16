const { Schema, model } = require('mongoose');

const otpSchema = new Schema({
  phone: { type: String, required: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  isUsed: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = model('Otp', otpSchema);
