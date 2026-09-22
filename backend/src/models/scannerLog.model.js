const { Schema, model } = require('mongoose');

// Every attempt to scan a handover QR (crate/order QR) is logged here, whether it succeeds or
// not — see order.service.js#verifyHandoverQr. Currently the only qrType is the Picker<->Delivery
// handover, but the field is kept open for other operational scans later.
const scannerLogSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  qrType: { type: String, enum: ['handover'], default: 'handover' },
  qrToken: { type: String, default: null },
  scannedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userType: { type: String, enum: ['picker', 'delivery'], required: true },
  deviceId: { type: String, default: null },
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  status: { type: String, enum: ['success', 'failed'], required: true },
  failureReason: { type: String, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = model('ScannerLog', scannerLogSchema);
