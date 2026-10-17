const { Order, DeliveryProfile, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { hasFullAccess, resolveStoreScope } = require('../../utils/storeScope');
const { PERMISSIONS } = require('../../utils/permissions');
const { trackingSnapshot, trackingConfig, freshRiderPoint } = require('../../services/tracking.service');

const ACTIVE = ['assigned', 'picked_up', 'out_for_delivery'];
const canSeeAll = (user) => hasFullAccess(user, PERMISSIONS.MANAGE_ORDERS) || hasFullAccess(user, PERMISSIONS.MANAGE_DELIVERY);

// GET /admin/tracking/riders -> the live map: every delivery partner who is online or on a job,
// with their last GPS fix and active orders, plus store locations. A store manager only sees
// riders currently working orders from their own hub. Live updates: 'rider:location' socket event.
const listRiders = catchAsync(async (req, res) => {
  const cfg = await trackingConfig();
  const scopedStore = canSeeAll(req.user) ? null : resolveStoreScope(req.user, null, PERMISSIONS.MANAGE_ORDERS);

  const orderWhere = { orderStatus: { $in: ACTIVE }, delivery: { $ne: null } };
  if (scopedStore) orderWhere.store = scopedStore;
  const orders = await Order.find(orderWhere).select('orderNumber orderStatus delivery store').populate('store', 'name');

  const ordersByRider = new Map();
  orders.forEach((o) => {
    const key = o.delivery.toString();
    if (!ordersByRider.has(key)) ordersByRider.set(key, []);
    ordersByRider.get(key).push({ orderId: o._id, orderNumber: o.orderNumber, orderStatus: o.orderStatus, hub: o.store?.name });
  });

  const profileWhere = scopedStore
    ? { user: { $in: [...ordersByRider.keys()] } }
    : { status: 'approved', $or: [{ isAvailable: true }, { user: { $in: [...ordersByRider.keys()] } }] };
  const profiles = await DeliveryProfile.find(profileWhere).populate('user', 'name phone');

  const riders = profiles.filter((p) => p.user).map((p) => {
    const fix = freshRiderPoint(p, cfg);
    return {
      riderId: p.user._id,
      name: p.user.name,
      phone: p.user.phone,
      isAvailable: p.isAvailable,
      lat: p.currentLat,
      lng: p.currentLng,
      updatedAt: p.locationUpdatedAt,
      stale: !fix,
      orders: ordersByRider.get(p.user._id.toString()) || [],
    };
  });

  const stores = await Store.find(scopedStore ? { _id: scopedStore } : { status: 'active' }).select('name lat lng serviceRadiusKm');
  new ApiResponse(200, { riders, stores, staleAfterMinutes: cfg.staleAfterMinutes }).send(res);
});

// GET /admin/orders/:id/tracking -> same live-tracking snapshot the customer sees (hub, drop,
// rider fix, ETA) for the admin order detail.
const getOrderTracking = catchAsync(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .select('orderNumber orderStatus statusLogs delivery store address items.pickupStore placedAt createdAt arrivedAtPickupAt arrivedAtDropAt nearbyAlertAt')
    .populate('delivery', 'name phone')
    .populate('store', 'name lat lng')
    .populate('address', 'line1 city pincode lat lng');
  if (!order) throw new ApiError(404, 'Order not found');
  if (!canSeeAll(req.user)) {
    const scoped = resolveStoreScope(req.user, null, PERMISSIONS.MANAGE_ORDERS);
    const involved = order.store._id.toString() === scoped || order.items.some((i) => i.pickupStore.toString() === scoped);
    if (!involved) throw new ApiError(403, 'You can only manage your assigned store.');
  }

  new ApiResponse(200, {
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    deliveryPartner: order.delivery,
    arrivedAtPickupAt: order.arrivedAtPickupAt,
    arrivedAtDropAt: order.arrivedAtDropAt,
    nearbyAlertAt: order.nearbyAlertAt,
    ...(await trackingSnapshot(order)),
  }).send(res);
});

module.exports = { listRiders, getOrderTracking };
