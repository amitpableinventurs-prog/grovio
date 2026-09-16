const { Schema, model } = require('mongoose');

const pickerProfileSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
  status: { type: String, enum: ['pending', 'approved', 'blocked'], default: 'pending' },
  isAvailable: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = model('PickerProfile', pickerProfileSchema);
