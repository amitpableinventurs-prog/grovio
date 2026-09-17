const { Schema, model } = require('mongoose');

const reviewSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  deliveryPartnerRating: { type: Number, min: 1, max: 5, default: null },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: null },
}, { timestamps: true });

module.exports = model('Review', reviewSchema);
