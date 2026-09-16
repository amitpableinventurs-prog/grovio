const { Schema, model } = require('mongoose');

const cartItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, default: null },
  qty: { type: Number, required: true, default: 1 },
  priceSnapshot: { type: Number, required: true },
});

// One cart document per user. Single-store cart: adding an item from a different
// store replaces `store` and clears `items`.
const cartSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  store: { type: Schema.Types.ObjectId, ref: 'Store', default: null },
  items: { type: [cartItemSchema], default: [] },
  couponCode: { type: String, default: null },
}, { timestamps: true });

module.exports = model('Cart', cartSchema);
