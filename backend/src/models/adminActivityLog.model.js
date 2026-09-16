const { Schema, model } = require('mongoose');

const adminActivityLogSchema = new Schema({
  admin: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true }, // e.g. "vendor.approve", "settlement.pay"
  entityType: { type: String, default: null }, // e.g. "Vendor", "Order"
  entityId: { type: Schema.Types.ObjectId, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = model('AdminActivityLog', adminActivityLogSchema);
