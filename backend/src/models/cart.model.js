const { Schema, model } = require('mongoose');

const cartItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, default: null },
  qty: { type: Number, required: true, default: 1 },
  priceSnapshot: { type: Number, required: true },
});

// One cart document per user. Items can come from multiple stores — checkout
// (see customer/orders.controller.js#loadAndPriceCart) splits them into one
// Order per store, each with its own delivery fee and picker/delivery run.
const cartSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: { type: [cartItemSchema], default: [] },
  couponCode: { type: String, default: null },
}, { timestamps: true });

module.exports = model('Cart', cartSchema);
