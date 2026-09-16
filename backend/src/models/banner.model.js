const { Schema, model } = require('mongoose');

const bannerSchema = new Schema({
  title: { type: String, default: null },
  image: { type: String, required: true },
  linkType: { type: String, enum: ['product', 'category', 'vendor', 'url', 'none'], default: 'none' },
  linkValue: { type: String, default: null },
  position: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = model('Banner', bannerSchema);
