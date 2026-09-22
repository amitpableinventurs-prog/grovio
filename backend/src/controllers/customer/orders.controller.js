const { Cart, Order, Product, Store, Address, Coupon, CouponUsage, Setting, Refund } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const generateOrderNumber = require('../../utils/orderNumber');
const { transitionOrder } = require('../../services/order.service');
const { splitOrderAcrossPickers } = require('../../services/assignment.service');
const { debitWallet, creditWallet } = require('../../services/payment.service');
const { notifyUser } = require('../../services/notification.service');

async function getSetting(key, fallback) {
  const row = await Setting.findOne({ key });
  return row ? row.value : fallback;
}

async function resolveCoupon(code, itemTotal, userId) {
  if (!code) return { discount: 0, coupon: null };

  const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
  if (!coupon) throw new ApiError(400, 'Invalid coupon code');

  const now = new Date();
  if (coupon.validFrom && now < coupon.validFrom) throw new ApiError(400, 'Coupon is not yet active');
  if (coupon.validTo && now > coupon.validTo) throw new ApiError(400, 'Coupon has expired');
  if (Number(itemTotal) < Number(coupon.minOrderAmount)) {
    throw new ApiError(400, `Minimum order amount for this coupon is ${coupon.minOrderAmount}`);
  }

  const usageCount = await CouponUsage.countDocuments({ coupon: coupon._id, user: userId });
  if (usageCount >= coupon.perUserLimit) throw new ApiError(400, 'Coupon usage limit reached');

  let discount = coupon.discountType === 'flat'
    ? Number(coupon.discountValue)
    : (Number(itemTotal) * Number(coupon.discountValue)) / 100;

  if (coupon.maxDiscount) discount = Math.min(discount, Number(coupon.maxDiscount));
  discount = Math.min(discount, Number(itemTotal));

  return { discount, coupon };
}

// Loads the customer's cart, validates the store/items, and computes the authoritative
// server-side total breakdown. Shared by the checkout preview and the real order placement
// so the numbers a customer sees before paying are exactly what gets charged.
async function loadAndPriceCart(userId, couponCodeOverride) {
  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart || !cart.items.length) throw new ApiError(400, 'Your cart is empty');

  const store = await Store.findById(cart.store);
  if (!store || store.status !== 'active') throw new ApiError(400, 'This store is currently unavailable');
  if (!store.isOpen) throw new ApiError(400, 'This store is currently closed');

  for (const item of cart.items) {
    if (!item.product) throw new ApiError(400, 'An item in your cart is no longer available');

    if (item.variantId) {
      const variant = item.product.variants.id(item.variantId);
      if (!variant || !variant.isAvailable || variant.stockQty < item.qty) {
        throw new ApiError(400, `${item.product.name} (${variant?.label || 'selected option'}) is out of stock`);
      }
    } else if (!item.product.isAvailable || item.product.stockQty < item.qty) {
      throw new ApiError(400, `${item.product.name} is out of stock`);
    }
  }

  const itemTotal = cart.items.reduce((sum, i) => sum + Number(i.priceSnapshot) * i.qty, 0);
  const deliveryFee = Number(await getSetting('deliveryFee', process.env.DEFAULT_DELIVERY_FEE || 25));
  const couponCode = couponCodeOverride !== undefined ? couponCodeOverride : cart.couponCode;
  const { discount, coupon } = await resolveCoupon(couponCode, itemTotal, userId);
  const tax = 0;
  const grandTotal = Number((itemTotal + deliveryFee + tax - discount).toFixed(2));

  return { cart, store, itemTotal, deliveryFee, discount, coupon, tax, grandTotal };
}

// POST /customer/checkout/summary  { couponCode? }  -> recalculate totals without placing the order
const checkoutSummary = catchAsync(async (req, res) => {
  const { couponCode } = req.body;
  const { itemTotal, deliveryFee, discount, tax, grandTotal, coupon, store } = await loadAndPriceCart(req.user.id, couponCode);

  new ApiResponse(200, {
    storeId: store._id,
    itemTotal,
    deliveryFee,
    discount,
    tax,
    grandTotal,
    couponCode: coupon ? coupon.code : null,
  }).send(res);
});

// POST /customer/orders  { addressId, paymentMethod }
// Note: a standalone (non-replica-set) MongoDB instance doesn't support multi-document
// transactions, so writes below run sequentially rather than atomically.
const placeOrder = catchAsync(async (req, res) => {
  const { addressId, paymentMethod = 'COD' } = req.body;

  const address = await Address.findOne({ _id: addressId, user: req.user.id });
  if (!address) throw new ApiError(404, 'Address not found');

  const { cart, store, itemTotal, deliveryFee, discount, coupon, tax, grandTotal } = await loadAndPriceCart(req.user.id);

  if (paymentMethod === 'WALLET') {
    await debitWallet({ userId: req.user.id, amount: grandTotal, reason: 'Order payment' });
  }

  const order = await Order.create({
    orderNumber: generateOrderNumber(),
    customer: req.user.id,
    store: store._id,
    address: addressId,
    itemTotal,
    deliveryFee,
    discount,
    tax,
    grandTotal,
    couponCode: coupon ? coupon.code : null,
    paymentMethod,
    paymentStatus: paymentMethod === 'WALLET' ? 'paid' : 'pending',
    items: cart.items.map((item) => {
      const variant = item.variantId ? item.product.variants.id(item.variantId) : null;
      return {
        product: item.product._id,
        variantId: item.variantId || null,
        variantLabel: variant ? variant.label : null,
        nameSnapshot: variant ? `${item.product.name} (${variant.label})` : item.product.name,
        price: item.priceSnapshot,
        qty: item.qty,
      };
    }),
    statusLogs: [{ status: 'placed', changedBy: req.user.id }],
  });

  for (const item of cart.items) {
    if (item.variantId) {
      await Product.updateOne(
        { _id: item.product._id, 'variants._id': item.variantId },
        { $inc: { 'variants.$.stockQty': -item.qty } }
      );
    } else {
      await Product.findByIdAndUpdate(item.product._id, { $inc: { stockQty: -item.qty } });
    }
  }

  if (coupon) {
    await CouponUsage.create({ coupon: coupon._id, user: req.user.id, order: order._id });
  }

  cart.items = [];
  cart.store = null;
  cart.couponCode = null;
  await cart.save();

  // Stores are company-owned now — there's no vendor to approve the order, so it's accepted
  // immediately and split across up to 3 available pickers at this store, who then work their
  // assigned items in parallel — see assignment.service.js#splitOrderAcrossPickers.
  await transitionOrder({ order, toStatus: 'accepted', changedBy: req.user.id, note: 'Auto-accepted (no vendor approval required)' });

  const pickerIds = await splitOrderAcrossPickers(order, store._id);
  if (pickerIds.length) {
    await order.save();
    await transitionOrder({ order, toStatus: 'picking', changedBy: req.user.id, note: `Split across ${pickerIds.length} picker(s)` });
    await Promise.all(pickerIds.map((pickerId) => notifyUser(pickerId, {
      title: 'New order assigned',
      body: `Order ${order.orderNumber} is ready to be picked at ${store.name}.`,
      type: 'new_order',
      data: { orderId: order._id },
    })));
  }

  new ApiResponse(201, order, 'Order placed successfully').send(res);
});

const listOrders = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status } = req.query;

  const where = { customer: req.user.id };
  if (status) where.orderStatus = status;

  const [rows, count] = await Promise.all([
    Order.find(where).populate('store', 'name logo').sort({ createdAt: -1 }).skip(offset).limit(limit),
    Order.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const getOrderDetail = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customer: req.user.id })
    .populate('store')
    .populate('address');
  if (!order) throw new ApiError(404, 'Order not found');
  new ApiResponse(200, order).send(res);
});

// GET /customer/orders/:id/tracking  -> lightweight status-timeline view for a tracking screen
const getTracking = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customer: req.user.id })
    .select('orderNumber orderStatus statusLogs deliveredAt delivery')
    .populate('delivery', 'name phone');
  if (!order) throw new ApiError(404, 'Order not found');

  new ApiResponse(200, {
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    statusLogs: order.statusLogs,
    deliveredAt: order.deliveredAt,
    deliveryPartner: order.delivery,
  }).send(res);
});

const getDeliveryPin = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customer: req.user.id }).select('+deliveryPin orderStatus');
  if (!order) throw new ApiError(404, 'Order not found');
  if (!['assigned', 'out_for_delivery'].includes(order.orderStatus) || !order.deliveryPin) {
    throw new ApiError(400, 'No delivery PIN available for this order yet');
  }
  new ApiResponse(200, { deliveryPin: order.deliveryPin }).send(res);
});

const cancelOrder = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customer: req.user.id });
  if (!order) throw new ApiError(404, 'Order not found');

  const { reason } = req.body;
  order.cancelReason = reason || 'Cancelled by customer';
  await order.save();
  await transitionOrder({ order, toStatus: 'cancelled', changedBy: req.user.id, note: order.cancelReason });

  if (order.paymentStatus === 'paid') {
    await creditWallet({ userId: req.user.id, amount: order.grandTotal, reason: 'Order cancellation refund', refOrderId: order._id });
    await Refund.create({ order: order._id, amount: order.grandTotal, reason: order.cancelReason, initiatedBy: req.user.id });
    order.paymentStatus = 'refunded';
    await order.save();
  }

  new ApiResponse(200, order, 'Order cancelled').send(res);
});

module.exports = { checkoutSummary, placeOrder, listOrders, getOrderDetail, getTracking, getDeliveryPin, cancelOrder };
