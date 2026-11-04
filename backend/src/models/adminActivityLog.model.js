const { Schema, model } = require('mongoose');

const adminActivityLogSchema = new Schema({
  admin: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true }, // e.g. "vendor.approve", "settlement.pay"
  entityType: { type: String, default: null }, // e.g. "Vendor", "Order"
  entityId: { type: Schema.Types.ObjectId, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });

// Activity Logs page: newest first, optionally one admin's.
adminActivityLogSchema.index({ createdAt: -1 });
adminActivityLogSchema.index({ admin: 1, createdAt: -1 });

module.exports = model('AdminActivityLog', adminActivityLogSchema);
