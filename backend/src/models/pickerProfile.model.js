const { Schema, model } = require('mongoose');

const pickerProfileSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
  status: { type: String, enum: ['pending', 'approved', 'blocked'], default: 'pending' },
  isAvailable: { type: Boolean, default: false },

  // Admin-entered onboarding details (see admin/pickers.controller.js#createPicker).
  employeeId: { type: String, unique: true, sparse: true },
  address: { type: String, default: null },
  idProofType: { type: String, default: null },
  idProofNumber: { type: String, default: null },
  idProofDocument: { type: String, default: null },
  emergencyContactName: { type: String, default: null },
  emergencyContactPhone: { type: String, default: null },
  joiningDate: { type: Date, default: null },
  shift: { type: String, default: null },

  // Live GPS, used to pick the dynamic Apex consolidation point once a picker's sub-order is ready.
  currentLat: { type: Number, default: null },
  currentLng: { type: Number, default: null },
  locationUpdatedAt: { type: Date, default: null },
  onlineStatus: { type: String, enum: ['online', 'offline'], default: 'offline' },
}, { timestamps: true });

module.exports = model('PickerProfile', pickerProfileSchema);
