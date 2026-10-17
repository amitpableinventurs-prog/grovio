const { Schema, model } = require('mongoose');

// An insulated bag for frozen items, belonging to a store. Its QR label encodes `code`. Scanned out
// to a delivery partner at pickup and back in at a store after delivery (services/coldBag.service.js).
const coldBagSchema = new Schema({
  code: { type: String, required: true, unique: true },
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  status: { type: String, enum: ['available', 'issued', 'lost', 'retired'], default: 'available' },
  // While issued:
  issuedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  currentIssue: { type: Schema.Types.ObjectId, ref: 'ColdBagIssue', default: null },
  label: { type: String, default: null },
}, { timestamps: true });

module.exports = model('ColdBag', coldBagSchema);
