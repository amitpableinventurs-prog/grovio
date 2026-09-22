const crypto = require('crypto');
const { Wishlist, Product } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

async function getOrCreateWishlist(userId) {
  let wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) wishlist = await Wishlist.create({ user: userId, items: [] });
  return wishlist;
}

// GET /customer/wishlist
const getWishlist = catchAsync(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user.id);
  await wishlist.populate({ path: 'items.product' });
  new ApiResponse(200, wishlist).send(res);
});

// POST /customer/wishlist/items  { productId }
const addToWishlist = catchAsync(async (req, res) => {
  const { productId } = req.body;
  if (!productId) throw new ApiError(400, 'productId is required');

  const product = await Product.findById(productId);
  if (!product) throw new ApiError(404, 'Product not found');

  const wishlist = await getOrCreateWishlist(req.user.id);
  const alreadyAdded = wishlist.items.some((i) => i.product.toString() === productId);
  if (!alreadyAdded) {
    wishlist.items.push({ product: productId });
    await wishlist.save();
  }

  await wishlist.populate({ path: 'items.product' });
  new ApiResponse(200, wishlist, alreadyAdded ? 'Already in wishlist' : 'Added to wishlist').send(res);
});

// DELETE /customer/wishlist/items/:productId
const removeFromWishlist = catchAsync(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user.id);
  wishlist.items = wishlist.items.filter((i) => i.product.toString() !== req.params.productId);
  await wishlist.save();

  await wishlist.populate({ path: 'items.product' });
  new ApiResponse(200, wishlist, 'Removed from wishlist').send(res);
});

// DELETE /customer/wishlist
const clearWishlist = catchAsync(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user.id);
  wishlist.items = [];
  await wishlist.save();
  new ApiResponse(200, wishlist, 'Wishlist cleared').send(res);
});

// POST /customer/wishlist/share -> turns on public read-only viewing of this wishlist and
// returns the token to build a link from (e.g. https://app.grovio.com/wishlist/shared/:shareToken
// — the frontend owns the actual URL shape). Idempotent: calling it again while already shared
// just returns the existing token rather than rotating it, so a link already sent out keeps working.
const shareWishlist = catchAsync(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user.id);
  if (!wishlist.shareToken) {
    wishlist.shareToken = crypto.randomBytes(16).toString('hex');
    await wishlist.save();
  }
  new ApiResponse(200, { shareToken: wishlist.shareToken }, 'Wishlist sharing enabled').send(res);
});

// DELETE /customer/wishlist/share -> turns sharing back off; any previously shared link stops working
const unshareWishlist = catchAsync(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user.id);
  wishlist.shareToken = null;
  await wishlist.save();
  new ApiResponse(200, null, 'Wishlist sharing disabled').send(res);
});

module.exports = { getWishlist, addToWishlist, removeFromWishlist, clearWishlist, shareWishlist, unshareWishlist };
