const { Cart, Order, Product, Store, Coupon, CouponUsage } = require('../../models');
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
  await cart.populate({ path: 'items.product', populate: { path: 'store', select: 'name' } });
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
  if (!cart.items.length) cart.couponCode = null;
  await cart.save();

  new ApiResponse(200, cart, 'Item removed from cart').send(res);
});

const clearCart = catchAsync(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  cart.items = [];
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

const REORDER_REASONS = {
  removed: 'No longer sold',
  unavailable: 'Currently unavailable',
  out_of_stock: 'Out of stock',
  store_unavailable: 'Store is not taking orders',
};

// POST /customer/orders/:id/reorder  { replaceCart? } -> puts a past order's items back in the
// cart at today's prices, as many as are in stock, and says what couldn't be added and why.
// Adds to what's already in the cart, or with replaceCart: true empties it first (only if at least
// one item can be added). Checkout still checks stock, store hours and the coupon as usual.
const reorder = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customer: req.user.id }).select('orderNumber items');
  if (!order) throw new ApiError(404, 'Order not found');

  // The same product + option can appear more than once in an order: ask for it once.
  const wanted = new Map();
  for (const i of order.items) {
    const key = `${i.product}:${i.variantId || ''}`;
    const row = wanted.get(key) || { productId: i.product, variantId: i.variantId || null, name: i.nameSnapshot, variantLabel: i.variantLabel || null, qty: 0, oldPrice: i.price };
    row.qty += i.qty;
    wanted.set(key, row);
  }

  const products = await Product.find({ _id: { $in: [...wanted.values()].map((w) => w.productId) } });
  const productById = new Map(products.map((p) => [p.id, p]));
  const stores = await Store.find({ _id: { $in: products.map((p) => p.store) } }).select('status');
  const activeStores = new Set(stores.filter((s) => s.status === 'active').map((s) => s.id));

  const cart = await getOrCreateCart(req.user.id);
  const inCart = (w) => (req.body.replaceCart ? null : cart.items.find((i) => i.product.toString() === String(w.productId) && String(i.variantId || '') === String(w.variantId || '')));

  const toAdd = [];
  const unavailable = [];
  for (const w of wanted.values()) {
    const product = productById.get(String(w.productId));
    const variant = product && w.variantId ? product.variants.id(w.variantId) : null;
    let reason = null;
    if (!product) reason = 'removed';
    else if (!activeStores.has(String(product.store))) reason = 'store_unavailable';
    else if (product.status !== 'active' || !product.isAvailable || (w.variantId && (!variant || !variant.isAvailable))) reason = 'unavailable';

    const stock = variant ? variant.stockQty : product?.stockQty ?? 0;
    const room = Math.max(0, stock - (inCart(w)?.qty || 0));
    if (!reason && room < 1) reason = 'out_of_stock';
    if (reason) {
      // Out of stock only because the cart already holds every one left: say so.
      const reasonText = reason === 'out_of_stock' && stock > 0 ? `Only ${stock} in stock, already in your cart` : REORDER_REASONS[reason];
      unavailable.push({ productId: w.productId, variantId: w.variantId, name: product?.name || w.name, variantLabel: w.variantLabel, qty: w.qty, reason, reasonText });
      continue;
    }
    const price = variant ? variant.discountPrice || variant.price : product.discountPrice || product.price;
    const qty = Math.min(w.qty, room);
    toAdd.push({ ...w, name: product.name, qty, requestedQty: w.qty, limitedByStock: qty < w.qty, price, priceChanged: price !== w.oldPrice });
  }

  if (toAdd.length) {
    if (req.body.replaceCart) {
      cart.items = [];
      cart.couponCode = null;
    }
    for (const a of toAdd) {
      const line = inCart(a);
      if (line) {
        line.qty += a.qty;
        line.priceSnapshot = a.price;
      } else {
        cart.items.push({ product: a.productId, variantId: a.variantId, qty: a.qty, priceSnapshot: a.price });
      }
    }
    await cart.save();
  }

  await cart.populate({ path: 'items.product', populate: { path: 'store', select: 'name' } });
  const total = wanted.size;
  const message = !toAdd.length
    ? 'None of the items from this order are available right now'
    : toAdd.length === total ? `All ${total} item${total === 1 ? '' : 's'} added to your cart` : `${toAdd.length} of ${total} items added to your cart`;
  new ApiResponse(200, {
    cart: { ...cart.toObject(), subtotal: computeSubtotal(cart) },
    orderNumber: order.orderNumber,
    summary: { items: total, added: toAdd.length, unavailable: unavailable.length },
    added: toAdd.map(({ productId, variantId, name, variantLabel, qty, requestedQty, limitedByStock, price, oldPrice, priceChanged }) => ({ productId, variantId, name, variantLabel, qty, requestedQty, limitedByStock, price, oldPrice, priceChanged })),
    unavailable,
  }, message).send(res);
});

module.exports = { getCart, addToCart, updateCartItem, removeCartItem, clearCart, applyCoupon, removeCoupon, reorder };
