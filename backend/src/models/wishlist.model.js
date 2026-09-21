const { Schema, model } = require('mongoose');

const wishlistItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

// One wishlist document per user. Unlike Cart, a wishlist is not scoped to a single
// store — customers can save products across stores to buy later.
const wishlistSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: { type: [wishlistItemSchema], default: [] },
}, { timestamps: true });

module.exports = model('Wishlist', wishlistSchema);
