const { Schema, model } = require('mongoose');

// A case of a delivery partner's account being put on hold ("Account on hold — Face not
// matching"), by the system or an admin (services/accountHold.service.js). While a hold is active
// the partner can't go online or take orders. It lifts itself at releaseAt, or an admin unlocks it.
const accountHoldSchema = new Schema({
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reason: {
    type: String,
    enum: ['face_mismatch', 'cold_bag_not_returned', 'cash_not_deposited', 'fraud', 'misconduct', 'documents', 'other'],
    required: true,
  },
  // Shown in the app: "Face not matching".
  title: { type: String, required: true },
  // "View last case": what happened.
  details: { type: String, default: null },
  evidence: { type: [String], default: [] },
  startedAt: { type: Date, default: Date.now },
  // null = until an admin unlocks it.
  releaseAt: { type: Date, default: null },
  releasedAt: { type: Date, default: null },
  releaseType: { type: String, enum: [null, 'auto', 'manual'], default: null },
  releasedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  releaseNote: { type: String, default: null },
  // null = placed by the system.
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

accountHoldSchema.index({ releasedAt: 1, releaseAt: 1 });

module.exports = model('AccountHold', accountHoldSchema);
