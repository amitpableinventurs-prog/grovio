const { Schema, model } = require('mongoose');

const settingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: null },
}, { timestamps: true });

module.exports = model('Setting', settingSchema);
