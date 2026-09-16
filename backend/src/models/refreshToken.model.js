const { Schema, model } = require('mongoose');

// Refresh tokens are stored hashed (never the raw token) — see auth/token.service.js.
const refreshTokenSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true, unique: true },
  deviceId: { type: String, default: null },
  platform: { type: String, default: null },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = model('RefreshToken', refreshTokenSchema);
