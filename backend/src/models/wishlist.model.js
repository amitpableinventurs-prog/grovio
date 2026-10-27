const { Schema, model } = require('mongoose');

const wishlistItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

// One wishlist document per user. Unlike Cart, a wishlist is not scoped to a single
// store — customers can save products across stores to buy later.
const wishlistSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: { type: [wishlistItemSchema], default: [] },
  // Set only once the customer opts in via POST /customer/wishlist/share — absent means sharing is
  // off. Lets anyone with the link view the wishlist (read-only, no auth) via
  // GET /common/wishlist/:shareToken; see common/public.controller.js#getSharedWishlist.
  // No default and never null: a sparse unique index still indexes null, so a second null clashes.
  shareToken: { type: String, unique: true, sparse: true },
}, { timestamps: true });

module.exports = model('Wishlist', wishlistSchema);
