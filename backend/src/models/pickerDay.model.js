const { Schema, model } = require('mongoose');

// One picker's settled day (services/pickerPay.service.js#settleDay): the day-level bonuses
// (productivity, quality, Sunday/holiday) and the minimum-guarantee top-up are worked out and
// credited once the day is over (plus a delay for error reports). Per-order picking pay is
// credited as each order is completed and only summarised here.
const pickerDaySchema = new Schema({
  picker: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // local YYYY-MM-DD
  status: { type: String, enum: ['settled'], default: 'settled' },
  figures: { type: Schema.Types.Mixed, default: {} },
  total: { type: Number, default: 0 },
  settledAt: { type: Date, default: Date.now },
}, { timestamps: true });

pickerDaySchema.index({ picker: 1, date: 1 }, { unique: true });

module.exports = model('PickerDay', pickerDaySchema);
