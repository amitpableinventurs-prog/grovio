const { Schema, model } = require('mongoose');

const variantSchema = new Schema({
  label: { type: String, required: true }, // e.g. "500g", "1kg", "Red / L"
  price: { type: Number, required: true },
  discountPrice: { type: Number, default: null },
  stockQty: { type: Number, default: 0 },
  sku: { type: String, default: null },
  isAvailable: { type: Boolean, default: true },
  // Overrides the product's weightKg for this variant.
  weightKg: { type: Number, default: null, min: 0 },
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
  // Frozen / chilled (ice cream, meat, frozen snacks): an order containing it must travel in a
  // cold bag, scanned out at pickup and back in at the store (services/coldBag.service.js).
  requiresColdBag: { type: Boolean, default: false },
  // How the picker is paid for picking it (services/pickerPay.service.js). null = worked out from
  // the category (fruits & vegetables, dairy) and requiresColdBag (frozen), else 'normal'.
  pickType: {
    type: String,
    enum: [null, 'normal', 'small', 'fruits_veg', 'dairy', 'frozen', 'fragile', 'heavy_5_10', 'heavy_10_plus', 'special'],
    default: null,
  },
  // Shipping weight per unit, for the delivery partner's heavy-load bonus
  // (services/riderPay.service.js). null = unknown (counts as 0).
  weightKg: { type: Number, default: null, min: 0 },
  // What the product costs us, for the per-order contribution report. null = use the default margin.
  costPrice: { type: Number, default: null },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  // System-generated scannable code (not a real-world UPC/EAN) — printed by admin as a physical
  // label for the product. See utils/productQr.js#generateProductQrToken.
  qrToken: { type: String, unique: true, sparse: true },
}, { timestamps: true });

module.exports = model('Product', productSchema);
