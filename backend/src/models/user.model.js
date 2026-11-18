const { Schema, model } = require('mongoose');

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  // Unique per role, not globally (see the index below): one number can have a customer account
  // AND a delivery/picker account, each signed in from its own app.
  phone: { type: String },
  password: { type: String, select: false },
  role: { type: String, enum: ['admin', 'customer', 'picker', 'delivery'], required: true },
  gender: { type: String, enum: ['male', 'female', 'other'], default: null },
  dateOfBirth: { type: Date, default: null },
  // Only meaningful for role === 'admin'. ['*'] means full super-admin access;
  // otherwise a subset of PERMISSIONS (see utils/permissions.js).
  permissions: { type: [String], default: [] },
  // Only meaningful for a restricted admin with MANAGE_OWN_STORE_INVENTORY: scopes every
  // catalog/inventory action to this one store instead of the platform-wide MANAGE_CATALOG scope.
  assignedStore: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
  profileImage: { type: String, default: null },
  fcmToken: { type: String, default: null },
  isActive: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  // Set when a customer account is deleted (services/accountDeletion.service.js); the user is kept,
  // anonymised, so their orders and payments still have someone to point at.
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

// Admin lists and counts by role (customers, pickers, delivery partners), newest first.
userSchema.index({ role: 1, createdAt: -1 });
// One account per (phone, role). Partial rather than sparse: role is always set, so a sparse
// compound index would still clash on the many phone-less admin accounts.
userSchema.index(
  { phone: 1, role: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);

module.exports = model('User', userSchema);
