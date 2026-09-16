const { Schema, model } = require('mongoose');

// The business entity behind one or more Stores. Approval, documents and commission
// live here at the business level; physical location/timings live on Store.
const vendorSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  businessName: { type: String, required: true },
  documents: { type: [String], default: [] },
  commissionPercent: { type: Number, default: 10 },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'blocked'], default: 'pending' },
}, { timestamps: true });

module.exports = model('Vendor', vendorSchema);
