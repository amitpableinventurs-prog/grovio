const { Schema, model } = require('mongoose');

// Multi-device FCM token tracking, keyed by (user, deviceId).
const userDeviceSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: String, required: true },
  platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
  fcmToken: { type: String, default: null },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

userDeviceSchema.index({ user: 1, deviceId: 1 }, { unique: true });

module.exports = model('UserDevice', userDeviceSchema);
