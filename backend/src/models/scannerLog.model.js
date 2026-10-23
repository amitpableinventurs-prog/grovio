const { Schema, model } = require('mongoose');

// Every attempt to scan a handover QR (crate/order QR) is logged here, whether it succeeds or
// not — see order.service.js#verifyHandoverQr. qrType 'handover' is the Picker<->Delivery handover
// QR from the picker app; 'hub_pickup' is the order's QR on the hub screen
// (controllers/delivery/hub.controller.js#scan).
const scannerLogSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  qrType: { type: String, enum: ['handover', 'hub_pickup'], default: 'handover' },
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
