const { Schema, model } = require('mongoose');

// One error for Admin > Error Logs (services/errorLog.service.js): logged by the backend itself
// (a 5xx response, a failed background job, a crash) or reported by a client app through
// POST /common/error-logs (Customer / Picker / Delivery apps, or a web panel). Kept 90 days.
const errorLogSchema = new Schema({
  source: { type: String, enum: ['backend', 'mobile', 'web'], required: true },
  app: { type: String, enum: ['backend', 'customer', 'picker', 'delivery', 'vendor', 'admin'], required: true },
  level: { type: String, enum: ['fatal', 'error', 'warning'], default: 'error' },
  message: { type: String, required: true },
  stack: { type: String, default: null },
  // When it happened: the device's clock for client reports (they may arrive later, after being
  // offline), the server's otherwise. createdAt is when it reached the server.
  occurredAt: { type: Date, required: true, default: Date.now },
  // The API request it happened on (backend), or the API call that failed (client).
  method: { type: String, default: null },
  url: { type: String, default: null },
  statusCode: { type: Number, default: null },
  // Client details.
  screen: { type: String, default: null },
  platform: { type: String, default: null },
  appVersion: { type: String, default: null },
  deviceModel: { type: String, default: null },
  osVersion: { type: String, default: null },
  // Who was signed in, if anyone.
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  role: { type: String, default: null },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  // The request (body/query/params, secrets masked) or the client's own extra context.
  context: { type: Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

errorLogSchema.index({ occurredAt: -1 });
errorLogSchema.index({ source: 1, occurredAt: -1 });
errorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = model('ErrorLog', errorLogSchema);
