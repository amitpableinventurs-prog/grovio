const { Schema, model } = require('mongoose');

const couponUsageSchema = new Schema({
  coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
}, { timestamps: true });

// "Used this coupon N times" check at apply and checkout.
couponUsageSchema.index({ coupon: 1, user: 1 });

module.exports = model('CouponUsage', couponUsageSchema);
