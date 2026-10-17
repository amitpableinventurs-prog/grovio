const { Schema, model } = require('mongoose');

// A selfie a delivery partner takes to prove it's them riding (e.g. when going online), compared
// with their onboarding selfie. A reviewer (or a face-match service) marks it; a mismatch puts
// the account on hold ("Face not matching") — services/accountHold.service.js.
const selfieCheckSchema = new Schema({
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  image: { type: String, required: true },
  status: { type: String, enum: ['pending', 'match', 'mismatch'], default: 'pending' },
  // 0–100 when a face-match service scored it.
  score: { type: Number, default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  hold: { type: Schema.Types.ObjectId, ref: 'AccountHold', default: null },
}, { timestamps: true });

selfieCheckSchema.index({ status: 1, createdAt: -1 });

module.exports = model('SelfieCheck', selfieCheckSchema);
