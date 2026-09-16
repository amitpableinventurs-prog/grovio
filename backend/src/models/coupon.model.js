const { Schema, model } = require('mongoose');

const couponSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null }, // null = platform-wide (admin) coupon; set = vendor-specific offer (applies across all of that vendor's stores)
  discountType: { type: String, enum: ['flat', 'percent'], required: true },
  discountValue: { type: Number, required: true },
  minOrderAmount: { type: Number, default: 0 },
  maxDiscount: { type: Number, default: null },
  validFrom: { type: Date, default: null },
  validTo: { type: Date, default: null },
  usageLimit: { type: Number, default: null },
  perUserLimit: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = model('Coupon', couponSchema);
