const { Schema, model } = require('mongoose');

const variantSchema = new Schema({
  label: { type: String, required: true }, // e.g. "500g", "1kg", "Red / L"
  price: { type: Number, required: true },
  discountPrice: { type: Number, default: null },
  stockQty: { type: Number, default: 0 },
  sku: { type: String, default: null },
  isAvailable: { type: Boolean, default: true },
});

const productSchema = new Schema({
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  name: { type: String, required: true },
  description: { type: String, default: null },
  images: { type: [String], default: [] },
  unit: { type: String, default: 'pcs' },
  price: { type: Number, required: true },
  discountPrice: { type: Number, default: null },
  stockQty: { type: Number, default: 0 },
  sku: { type: String, default: null },
  variants: { type: [variantSchema], default: [] },
  isAvailable: { type: Boolean, default: true },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: true });

module.exports = model('Product', productSchema);
