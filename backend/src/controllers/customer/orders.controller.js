const { Cart, Order, Product, Store, Address, Coupon, CouponUsage, Setting, Refund, Wallet } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const generateOrderNumber = require('../../utils/orderNumber');
const { transitionOrder } = require('../../services/order.service');
const { splitOrderAcrossPickers } = require('../../services/assignment.service');
const { debitWallet, creditWallet } = require('../../services/payment.service');
const { notifyUser } = require('../../services/notification.service');
const { getChargeConfig, computeCharges, round2 } = require('../../services/charges.service');
const { trackingSnapshot, checkServiceArea } = require('../../services/tracking.service');
const { requestOrderConfirmation } = require('../../services/ivr.service');
const { enabledPaymentOptions } = require('../../services/gateways');

function serviceAreaError(check) {
  const s = check.outside[0];
  return new ApiError(400, `This address is outside ${s.storeName}'s delivery area (${s.distanceKm} km away, delivers up to ${s.radiusKm} km). Choose a closer address or remove its items.`);
}

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

// Loads the customer's cart, validates each store/item, and computes the authoritative
// server-side total breakdown — split per store, since a cart can hold items from multiple
// stores. They still end up as a single Order (see placeOrder below), consolidated at a hub
// store; the per-store split here is what drives per-store picker assignment. Shared by the
// checkout preview and the real order placement so the numbers a customer sees before paying
// are exactly what gets charged.
async function loadAndPriceCart(userId, couponCodeOverride) {
  const cart = await Cart.findOne({ user: userId }).populate('items.product');
  if (!cart || !cart.items.length) throw new ApiError(400, 'Your cart is empty');

  const itemsByStore = new Map();
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

    const storeId = item.product.store.toString();
    if (!itemsByStore.has(storeId)) itemsByStore.set(storeId, []);
    itemsByStore.get(storeId).push(item);
  }

  const stores = await Store.find({ _id: { $in: [...itemsByStore.keys()] } });
  const storeById = new Map(stores.map((s) => [s._id.toString(), s]));

  const itemTotal = cart.items.reduce((sum, i) => sum + Number(i.priceSnapshot) * i.qty, 0);
  const couponCode = couponCodeOverride !== undefined ? couponCodeOverride : cart.couponCode;
  const { discount, coupon } = await resolveCoupon(couponCode, itemTotal, userId);

  const storeGroups = [];
  let discountRemaining = discount;
  let groupsLeft = itemsByStore.size;
  for (const [storeId, items] of itemsByStore) {
    const store = storeById.get(storeId);
    if (!store || store.status !== 'active') throw new ApiError(400, 'One of the stores in your cart is currently unavailable');
    if (!store.isOpen) throw new ApiError(400, `${store.name} is currently closed`);

    const groupItemTotal = items.reduce((sum, i) => sum + Number(i.priceSnapshot) * i.qty, 0);
    groupsLeft -= 1;
    // Last group absorbs whatever's left of the discount so the parts always sum exactly to
    // the whole — proportional split on every other group would otherwise drift by rounding.
    const groupDiscount = groupsLeft === 0
      ? Number(discountRemaining.toFixed(2))
      : Number((discount * (groupItemTotal / itemTotal)).toFixed(2));
    discountRemaining = Number((discountRemaining - groupDiscount).toFixed(2));

    storeGroups.push({
      store,
      items,
      itemTotal: groupItemTotal,
      discount: groupDiscount,
    });
  }

  // Delivery / handling / packing / surcharge are charged ONCE per order (not per store), as
  // configured on the admin Charges page — see services/charges.service.js.
  const charges = computeCharges(itemTotal, await getChargeConfig());
  const tax = 0;
  const grandTotal = round2(
    itemTotal + charges.deliveryFee + charges.handlingCharge + charges.packingCharge + charges.surcharge + tax - discount
  );

  return { cart, storeGroups, itemTotal, charges, discount, coupon, tax, grandTotal };
}

// POST /customer/checkout/summary  { couponCode?, addressId? }  -> recalculate totals without
// placing the order. With addressId it also says whether every store can deliver there.
const checkoutSummary = catchAsync(async (req, res) => {
  const { couponCode, addressId } = req.body;
  const { itemTotal, charges, discount, tax, grandTotal, coupon, storeGroups } = await loadAndPriceCart(req.user.id, couponCode);

  let serviceArea = null;
  if (addressId) {
    const address = await Address.findOne({ _id: addressId, user: req.user.id });
    if (address) serviceArea = await checkServiceArea(storeGroups.map((g) => g.store), address);
  }

  // Included so the client can show/enable "Pay with Wallet" (and how much is available) at
  // checkout without a separate GET /customer/wallet call — placeOrder still re-checks the
  // balance itself when paymentMethod: 'WALLET' is actually submitted, this is just a preview.
  const wallet = await Wallet.findOne({ user: req.user.id });
  const walletBalance = wallet ? wallet.balance : 0;

  new ApiResponse(200, {
    stores: storeGroups.map((g) => ({
      storeId: g.store._id,
      storeName: g.store.name,
      itemTotal: g.itemTotal,
      discount: g.discount,
    })),
    itemTotal,
    deliveryFee: charges.deliveryFee,
    // Show "Add ₹X more for free delivery" while freeDeliveryApplied is false.
    freeDeliveryAbove: charges.freeDeliveryAbove,
    freeDeliveryApplied: charges.freeDeliveryApplied,
    handlingCharge: charges.handlingCharge,
    packingCharge: charges.packingCharge,
    surcharge: charges.surcharge,
    surchargeLabel: charges.surchargeLabel,
    discount,
    tax,
    grandTotal,
    couponCode: coupon ? coupon.code : null,
    walletBalance,
    walletSufficient: walletBalance >= grandTotal,
    serviceArea,
    paymentOptions: await enabledPaymentOptions(),
  }).send(res);
});

// POST /customer/orders  { addressId, paymentMethod }
// A cart spanning multiple stores becomes a SINGLE order, consolidated at a hub store — whichever
// of the cart's stores has the most items. Each item snapshots its own pickupStore (see
// order.model.js), and picking is split per store (see assignment.service.js#splitOrderAcrossPickers)
// — each picker picks and packs their own portion at their own store, no scanning. A non-hub
// store's picker gets their picked items to the hub themselves (picker coordination, not tracked
// by the app); the delivery partner only ever visits the hub for a single pickup — see
// delivery.controller.js#verifyHandoverOtpCtrl.
// Note: a standalone (non-replica-set) MongoDB instance doesn't support multi-document
// transactions, so writes below run sequentially rather than atomically.
const placeOrder = catchAsync(async (req, res) => {
  const { addressId, paymentMethod = 'COD' } = req.body;

  const address = await Address.findOne({ _id: addressId, user: req.user.id });
  if (!address) throw new ApiError(404, 'Address not found');

  const { cart, storeGroups, itemTotal, charges, discount, coupon, tax, grandTotal } = await loadAndPriceCart(req.user.id);

  const serviceArea = await checkServiceArea(storeGroups.map((g) => g.store), address);
  if (!serviceArea.serviceable) throw serviceAreaError(serviceArea);

  if (!(await enabledPaymentOptions()).some((o) => o.method === paymentMethod)) {
    throw new ApiError(400, `Payment method ${paymentMethod} is not available`);
  }

  if (paymentMethod === 'WALLET') {
    await debitWallet({ userId: req.user.id, amount: grandTotal, reason: 'Order payment' });
  }

  const hubGroup = storeGroups.reduce((max, g) => (g.items.length > max.items.length ? g : max), storeGroups[0]);
  const storeNameById = new Map(storeGroups.map((g) => [g.store._id.toString(), g.store.name]));

  const items = storeGroups.flatMap((group) =>
    group.items.map((item) => {
      const variant = item.variantId ? item.product.variants.id(item.variantId) : null;
      return {
        product: item.product._id,
        pickupStore: group.store._id,
        variantId: item.variantId || null,
        variantLabel: variant ? variant.label : null,
        nameSnapshot: variant ? `${item.product.name} (${variant.label})` : item.product.name,
        price: item.priceSnapshot,
        qty: item.qty,
      };
    })
  );

  const order = await Order.create({
    orderNumber: generateOrderNumber(),
    customer: req.user.id,
    store: hubGroup.store._id,
    address: addressId,
    itemTotal,
    deliveryFee: charges.deliveryFee,
    handlingCharge: charges.handlingCharge,
    packingCharge: charges.packingCharge,
    surcharge: charges.surcharge,
    surchargeLabel: charges.surchargeLabel,
    deliveryPartnerEarning: charges.deliveryPartnerEarning,
    discount,
    tax,
    grandTotal,
    couponCode: coupon ? coupon.code : null,
    paymentMethod,
    paymentStatus: paymentMethod === 'WALLET' ? 'paid' : 'pending',
    items,
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
  cart.couponCode = null;
  await cart.save();

  // COD confirmation call, when switched on (services/ivr.service.js). Never blocks checkout.
  requestOrderConfirmation(order).catch((err) => console.error(`Confirmation call for ${order.orderNumber} failed:`, err.message));

  // By default the order waits at 'placed' until an admin/store manager accepts it on the admin
  // panel's Live Orders board (PATCH /admin/orders/:id/accept, which then splits it to pickers);
  // the board hears about it through the order:created socket event. With the `autoAcceptOrders`
  // setting on, it's accepted right here instead and split across up to 3 pickers per store —
  // see assignment.service.js#splitOrderAcrossPickers. Read uncached so flipping the switch on
  // the board applies to the very next order.
  const autoAccept = (await getSetting('autoAcceptOrders', 'false')) === 'true';
  if (!autoAccept) {
    return new ApiResponse(201, order, 'Order placed successfully').send(res);
  }

  await transitionOrder({ order, toStatus: 'accepted', changedBy: req.user.id, note: 'Auto-accepted' });

  const pickerIds = await splitOrderAcrossPickers(order);
  if (pickerIds.length) {
    await order.save();
    await transitionOrder({ order, toStatus: 'picking', changedBy: req.user.id, note: `Split across ${pickerIds.length} picker(s)` });
    await Promise.all(order.pickTasks.map((task) => notifyUser(task.picker, {
      title: 'New order assigned',
      body: `Order ${order.orderNumber} is ready to be picked at ${storeNameById.get(task.store.toString())}.`,
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

// GET /customer/orders/:id/tracking -> status timeline plus live tracking: hub and drop
// locations, the delivery partner's last GPS fix (while they're on the job) and an ETA. Live
// updates after this arrive as 'delivery:location' socket events { orderId, lat, lng, eta }.
const getTracking = catchAsync(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customer: req.user.id })
    .select('orderNumber orderStatus statusLogs deliveredAt delivery store address placedAt createdAt arrivedAtPickupAt arrivedAtDropAt')
    .populate('delivery', 'name phone')
    .populate('store', 'name lat lng')
    .populate('address', 'lat lng');
  if (!order) throw new ApiError(404, 'Order not found');

  const snapshot = await trackingSnapshot(order);
  new ApiResponse(200, {
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    statusLogs: order.statusLogs,
    deliveredAt: order.deliveredAt,
    deliveryPartner: order.delivery,
    arrivedAtDropAt: order.arrivedAtDropAt,
    ...snapshot,
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
