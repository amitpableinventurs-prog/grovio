const { Schema, model } = require('mongoose');

const categorySchema = new Schema({
  name: { type: String, required: true },
  image: { type: String, default: null },
  parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });

module.exports = model('Category', categorySchema);
