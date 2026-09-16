const { Cart, Product, Store, Coupon, CouponUsage } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
}

function computeSubtotal(cart) {
  return cart.items.reduce((sum, i) => sum + Number(i.priceSnapshot) * i.qty, 0);
}

const getCart = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  await cart.populate([{ path: 'items.product' }, { path: 'store', select: 'name' }]);
  new ApiResponse(200, { ...cart.toObject(), subtotal: computeSubtotal(cart) }).send(res);
});

// POST /customer/cart/items  { productId, variantId?, qty }
const addToCart = catchAsync(async (req, res) => {
  const { productId, variantId, qty = 1 } = req.body;

  const product = await Product.findOne({ _id: productId, status: 'active', isAvailable: true });
  if (!product) throw new ApiError(404, 'Product not found or unavailable');

  let price = product.discountPrice || product.price;
  if (variantId) {
    const variant = product.variants.id(variantId);
    if (!variant || !variant.isAvailable) throw new ApiError(404, 'Variant not found or unavailable');
    price = variant.discountPrice || variant.price;
  }

  const cart = await getOrCreateCart(req.user.id);

  // Single-store cart: switching stores clears the previous cart + any applied coupon.
  if (cart.store && cart.store.toString() !== product.store.toString()) {
    cart.items = [];
    cart.couponCode = null;
  }
  cart.store = product.store;

  const existing = cart.items.find(
    (i) => i.product.toString() === productId && (i.variantId ? i.variantId.toString() : null) === (variantId || null)
  );

  if (existing) {
    existing.qty += Number(qty);
  } else {
    cart.items.push({ product: productId, variantId: variantId || null, qty, priceSnapshot: price });
  }

  await cart.save();
  new ApiResponse(200, cart, 'Added to cart').send(res);
});

// PATCH /customer/cart/items/:id  { qty }
const updateCartItem = catchAsync(async (req, res) => {
  const { qty } = req.body;
  const cart = await getOrCreateCart(req.user.id);
  const item = cart.items.id(req.params.id);
  if (!item) throw new ApiError(404, 'Cart item not found');

  if (qty <= 0) {
    cart.items.pull({ _id: req.params.id });
  } else {
    item.qty = qty;
  }
  await cart.save();

  new ApiResponse(200, cart, 'Cart updated').send(res);
});

const removeCartItem = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  const item = cart.items.id(req.params.id);
  if (!item) throw new ApiError(404, 'Cart item not found');

  cart.items.pull({ _id: req.params.id });
  if (!cart.items.length) {
    cart.store = null;
    cart.couponCode = null;
  }
  await cart.save();

  new ApiResponse(200, cart, 'Item removed from cart').send(res);
});

const clearCart = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  cart.items = [];
  cart.store = null;
  cart.couponCode = null;
  await cart.save();
  new ApiResponse(200, cart, 'Cart cleared').send(res);
});

// POST /customer/cart/apply-coupon  { code }
const applyCoupon = catchAsync(async (req, res) => {
  const { code } = req.body;
  const cart = await getOrCreateCart(req.user.id);
  if (!cart.items.length) throw new ApiError(400, 'Your cart is empty');

  const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
  if (!coupon) throw new ApiError(400, 'Invalid coupon code');

  if (coupon.vendor) {
    const store = await Store.findById(cart.store);
    if (!store || store.vendor.toString() !== coupon.vendor.toString()) {
      throw new ApiError(400, 'This coupon is not valid for this store');
    }
  }

  const now = new Date();
  if (coupon.validFrom && now < coupon.validFrom) throw new ApiError(400, 'Coupon is not yet active');
  if (coupon.validTo && now > coupon.validTo) throw new ApiError(400, 'Coupon has expired');

  const subtotal = computeSubtotal(cart);
  if (subtotal < Number(coupon.minOrderAmount)) {
    throw new ApiError(400, `Minimum order amount for this coupon is ${coupon.minOrderAmount}`);
  }

  const usageCount = await CouponUsage.countDocuments({ coupon: coupon._id, user: req.user.id });
  if (usageCount >= coupon.perUserLimit) throw new ApiError(400, 'Coupon usage limit reached');

  cart.couponCode = coupon.code;
  await cart.save();

  new ApiResponse(200, cart, 'Coupon applied').send(res);
});

// DELETE /customer/cart/coupon
const removeCoupon = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  cart.couponCode = null;
  await cart.save();
  new ApiResponse(200, cart, 'Coupon removed').send(res);
});

module.exports = { getCart, addToCart, updateCartItem, removeCartItem, clearCart, applyCoupon, removeCoupon };
