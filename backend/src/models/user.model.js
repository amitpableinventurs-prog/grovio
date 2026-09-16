const { Schema, model } = require('mongoose');

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  phone: { type: String, unique: true, sparse: true },
  password: { type: String, select: false },
  role: { type: String, enum: ['admin', 'vendor', 'customer', 'picker', 'delivery'], required: true },
  gender: { type: String, enum: ['male', 'female', 'other'], default: null },
  // Only meaningful for role === 'admin'. ['*'] means full super-admin access;
  // otherwise a subset of PERMISSIONS (see utils/permissions.js).
  permissions: { type: [String], default: [] },
  profileImage: { type: String, default: null },
  fcmToken: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = model('User', userSchema);
