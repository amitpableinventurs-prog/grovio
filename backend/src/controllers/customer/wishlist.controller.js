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

module.exports = { getWishlist, addToWishlist, removeFromWishlist, clearWishlist };
