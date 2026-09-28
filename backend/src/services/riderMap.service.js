const { DeliveryProfile, Store, Order } = require('../models');
const { distanceKm } = require('../utils/geo');
const { trackingConfig, planRiderRoute, freshRiderPoint } = require('./tracking.service');
const directions = require('./directions.service');

// The delivery app's home map (Feed): where the partner should be heading right now.
//   no active order  -> their hub: "Reach the store to pick orders", then "Scan QR to get orders"
//   order to collect -> the hub it's packed at
//   order picked up  -> the customer's location
//   delivered        -> back to the hub (no active order again)
// Each state comes with the destination, a road route (services/directions.service.js) and the
// actions the screen offers. The app refetches it on 'order:updated' socket events and as the
// partner moves.

const point = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : null);
const routeLabel = (r) => (r ? `${r.etaMinutes} mins | ${r.distanceKm} km away` : null);

// Rider position: from the app (best — send lat/lng), else their last GPS fix. An old fix is still
// used (to pick the hub and show a distance) but marked stale.
async function riderPosition(profile, query, cfg) {
  const given = (v) => v !== undefined && v !== '' && Number.isFinite(Number(v));
  if (given(query.lat) && given(query.lng)) return { lat: Number(query.lat), lng: Number(query.lng), stale: false };
  const fresh = freshRiderPoint(profile, cfg);
  if (fresh) return { lat: fresh.lat, lng: fresh.lng, stale: false };
  const last = point({ lat: profile?.currentLat, lng: profile?.currentLng });
  return last ? { ...last, stale: true } : null;
}

// The hub to head to: the one checked in at, else the nearest active store.
async function nearestHub(profile, position) {
  const checkedIn = profile?.hubCheckin?.store && profile.hubCheckin.expiresAt > new Date() ? String(profile.hubCheckin.store) : null;
  const stores = await Store.find({ status: 'active', lat: { $ne: null }, lng: { $ne: null } }).select('name address lat lng');
  if (!stores.length) return { store: null, checkedIn: false };
  const withDist = stores.map((s) => ({ s, km: distanceKm(position?.lat, position?.lng, s.lat, s.lng) }));
  const pick = (checkedIn && withDist.find((x) => String(x.s._id) === checkedIn)) || withDist.sort((a, b) => a.km - b.km)[0];
  return { store: pick.s, checkedIn: !!checkedIn && String(pick.s._id) === checkedIn, straightKm: pick.km };
}

function storeCard(store, route, position) {
  return {
    type: 'store',
    id: store._id,
    name: store.name,
    address: store.address,
    lat: store.lat,
    lng: store.lng,
    distanceLabel: route ? `${route.distanceKm} km away` : null,
    ...directions.navigationLinks(position, store),
  };
}

// GET /delivery/home-store — the store card on its own.
async function homeStore(riderId, query = {}) {
  const [profile, cfg] = await Promise.all([DeliveryProfile.findOne({ user: riderId }).select('currentLat currentLng locationUpdatedAt hubCheckin'), trackingConfig()]);
  const position = await riderPosition(profile, query, cfg);
  const { store, checkedIn, straightKm } = await nearestHub(profile, position);
  if (!store) return null;
  const route = await directions.route(position, store, { speedKmph: cfg.speedKmph });
  const atStore = Number.isFinite(straightKm) && straightKm * 1000 <= cfg.pickupGeofenceM;
  return {
    ...storeCard(store, route, position),
    distanceKm: route?.distanceKm ?? null,
    etaMinutes: route?.etaMinutes ?? null,
    etaLabel: routeLabel(route),
    polyline: route?.polyline || null,
    checkedIn,
    atStore,
    hint: checkedIn ? null : atStore ? 'Scan QR to get orders' : 'Reach the store to pick orders',
    mapsUrl: directions.navigationLinks(position, store).googleMapsUrl,
  };
}

const action = (key, label, extra = {}) => ({ key, label, ...extra });

// GET /delivery/map?lat=&lng=
async function mapState(riderId, query = {}) {
  const [profile, cfg] = await Promise.all([
    DeliveryProfile.findOne({ user: riderId }).select('isAvailable status currentLat currentLng locationUpdatedAt hubCheckin'),
    trackingConfig(),
  ]);
  const position = await riderPosition(profile, query, cfg);
  const base = {
    online: !!profile?.isAvailable,
    // stale: an old GPS fix — send lat/lng for an accurate route.
    rider: position ? { ...position, updatedAt: position.stale || !query.lat ? profile?.locationUpdatedAt || null : new Date() } : null,
    // Pill at the top of the map (hub check-in: POST /delivery/hub/checkin with the scanned QR).
    topAction: null,
  };

  // ---- On a job: next stop from the route planner (pickups before their drops).
  const plan = await planRiderRoute(riderId, position || {});
  const next = plan.stops[0];
  if (next) {
    const order = await Order.findById(next.orderIds[0])
      .select('orderNumber orderStatus arrivedAtPickupAt arrivedAtDropAt paymentMethod grandTotal customer address store')
      .populate('customer', 'name')
      .populate('address', 'line1 landmark city pincode lat lng')
      .populate('store', 'name address lat lng');
    const dest = point(next);
    const route = await directions.route(position, dest, { speedKmph: cfg.speedKmph });
    const straightM = dest && position ? distanceKm(position.lat, position.lng, dest.lat, dest.lng) * 1000 : Infinity;
    const orders = next.orderIds.map((id, i) => ({ orderId: id, orderNumber: next.orderNumbers[i] }));
    const common = {
      ...base,
      route: route ? { ...route, label: routeLabel(route) } : null,
      remainingStops: plan.stops.length,
      totalKm: plan.totalKm,
      // Full multi-stop route in Google Maps (all active orders).
      fullRouteUrl: plan.googleMapsUrl,
      orders,
    };

    if (next.type === 'pickup') {
      const atPickup = straightM <= cfg.pickupGeofenceM || !!order?.arrivedAtPickupAt;
      return {
        ...common,
        mode: atPickup ? 'at_pickup' : 'to_pickup',
        banner: atPickup
          ? { text: 'Collect the order: scan the package QR or enter the pickup OTP', tone: 'info' }
          : { text: `Reach ${order?.store?.name || 'the store'} to pick up ${orders.length > 1 ? `${orders.length} orders` : orders[0].orderNumber}`, tone: 'warning' },
        destination: { type: 'store', id: order?.store?._id, name: next.label, address: next.address, lat: next.lat, lng: next.lng, ...directions.navigationLinks(position, dest) },
        actions: [
          ...(atPickup ? [] : [action('navigate', 'Map')]),
          action('scan_package', 'Scan package QR', { method: 'POST', path: `/delivery/jobs/${orders[0].orderId}/scan` }),
          action('pickup_otp', 'Enter pickup OTP', { method: 'POST', path: `/delivery/jobs/${orders[0].orderId}/otp/verify` }),
        ],
      };
    }

    const atDrop = straightM <= cfg.dropGeofenceM || !!order?.arrivedAtDropAt;
    const cash = order?.paymentMethod === 'COD' ? Math.round(order.grandTotal * 100) / 100 : 0;
    return {
      ...common,
      mode: atDrop ? 'at_customer' : 'to_customer',
      banner: atDrop
        ? { text: cash ? `Collect ₹${cash} and the delivery PIN` : 'Ask the customer for the delivery PIN', tone: 'info' }
        : { text: `Deliver ${orders[0].orderNumber} to ${order?.customer?.name || 'the customer'}`, tone: 'info' },
      destination: {
        type: 'customer',
        orderId: orders[0].orderId,
        orderNumber: orders[0].orderNumber,
        // No phone number — calls are masked (POST /delivery/jobs/:id/call).
        name: order?.customer?.name || 'Customer',
        address: next.address,
        landmark: order?.address?.landmark || null,
        lat: next.lat,
        lng: next.lng,
        cashToCollect: cash,
        ...directions.navigationLinks(position, dest),
      },
      actions: [
        ...(atDrop ? [] : [action('navigate', 'Map')]),
        action('call_customer', 'Call customer', { method: 'POST', path: `/delivery/jobs/${orders[0].orderId}/call` }),
        ...(atDrop
          ? [action('complete', 'Complete delivery', { method: 'POST', path: `/delivery/jobs/${orders[0].orderId}/complete` })]
          : [action('arrived', "I've arrived", { method: 'POST', path: `/delivery/jobs/${orders[0].orderId}/arrived-drop` })]),
      ],
    };
  }

  // ---- No active order (just came online, or just delivered): back to the hub.
  const { store, checkedIn, straightKm } = await nearestHub(profile, position);
  if (!store) return { ...base, mode: base.online ? 'no_store' : 'offline', banner: null, destination: null, route: null, actions: [] };
  const route = await directions.route(position, store, { speedKmph: cfg.speedKmph });
  const atStore = Number.isFinite(straightKm) && straightKm * 1000 <= cfg.pickupGeofenceM;
  const destination = storeCard(store, route, position);

  if (!base.online) {
    return {
      ...base,
      mode: 'offline',
      banner: { text: 'Go online to start getting orders', tone: 'muted' },
      destination,
      route: route ? { ...route, label: routeLabel(route) } : null,
      actions: [action('go_online', 'Go online', { method: 'PATCH', path: '/delivery/availability', body: { isAvailable: true } })],
    };
  }
  const scanQr = action('scan_qr', 'Scan QR to get orders', { method: 'POST', path: '/delivery/hub/checkin' });
  let mode = 'to_store';
  let banner = { text: 'Reach the store to pick orders', tone: 'warning' };
  if (checkedIn) {
    mode = 'waiting_at_store';
    banner = { text: 'You are checked in. Pick an order from the hub screen or wait for one.', tone: 'success' };
  } else if (atStore) {
    mode = 'at_store';
    banner = { text: 'Scan QR to get orders', tone: 'info' };
  }
  return {
    ...base,
    topAction: checkedIn ? null : scanQr,
    mode,
    banner,
    destination,
    route: route ? { ...route, label: routeLabel(route) } : null,
    actions: checkedIn
      ? [action('hub_orders', 'Orders ready at this hub', { method: 'GET', path: '/delivery/hub/orders' })]
      : [...(atStore ? [] : [action('navigate', 'Map')]), scanQr],
  };
}

module.exports = { mapState, homeStore };
