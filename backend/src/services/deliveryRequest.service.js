const { Order, DeliveryProfile } = require('../models');
const { distanceKm } = require('../utils/geo');
const { getSetting } = require('./settings.service');
const { trackingConfig, freshRiderPoint } = require('./tracking.service');
const { emitToRooms, ROOMS } = require('../sockets');

// "New order request" card in the Delivery app: an order assigned to a partner that they haven't
// accepted yet (POST /delivery/jobs/:id/accept or .../reject). Everything the screen shows comes
// from here — the pay (riderPayQuote, worked out on assignment), the hub to pick up from and how
// far the partner is from it right now (their live location), the drop and the hub -> drop
// distance, and a countdown to answer by.
//
// Served by GET /delivery/requests and pushed as the 'delivery:request' socket event the moment
// an order is assigned (see order.service.js#transitionOrder).

const ROAD_FACTOR = 1.3; // same as services/tracking.service.js
const round1 = (n) => Math.round(n * 10) / 10;
const hasCoords = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
const roadKm = (a, b) => (hasCoords(a) && hasCoords(b) ? round1(distanceKm(a.lat, a.lng, b.lat, b.lng) * ROAD_FACTOR) : null);

async function requestSeconds() {
  const n = Number(await getSetting('deliveryRequestSeconds', 'DELIVERY_REQUEST_SECONDS'));
  return Number.isFinite(n) && n > 0 ? n : 30;
}

// "MG Road, near Regal Chowk"
function dropTitle(address) {
  if (!address) return null;
  return [address.line1, address.landmark ? `near ${address.landmark}` : null].filter(Boolean).join(', ');
}

const assignedAt = (order) => (order.statusLogs || []).filter((l) => l.status === 'assigned').map((l) => l.createdAt).pop() || order.updatedAt;

// One card. `order` has store + address populated; `rider` is { lat, lng } or null.
function buildCard(order, rider, { speedKmph, seconds }) {
  const q = order.riderPayQuote || {};
  const hub = hasCoords(order.store) ? { lat: order.store.lat, lng: order.store.lng } : null;
  const drop = hasCoords(order.address) ? { lat: order.address.lat, lng: order.address.lng } : null;

  const toPickupKm = roadKm(rider, hub);
  const pickupToDropKm = q.mappedDistanceKm ?? order.tripDistanceKm ?? roadKm(hub, drop);
  const respondBy = new Date(new Date(assignedAt(order)).getTime() + seconds * 1000);

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    earning: q.total ?? null,
    earningBreakup: {
      basePayout: q.basePayout ?? 0,
      peakBonus: q.peakBonus ?? 0,
      rainBonus: q.rainBonus ?? 0,
      heavyLoadBonus: q.heavyLoadBonus ?? 0,
      kmSlab: q.kmSlab ?? null,
    },
    pickup: {
      name: order.store?.name || null,
      address: order.store?.address || null,
      lat: hub?.lat ?? null,
      lng: hub?.lng ?? null,
      // From the partner's live location; null without a recent GPS fix.
      distanceKm: toPickupKm,
      etaMinutes: toPickupKm === null ? null : Math.max(1, Math.round((toPickupKm * 60) / speedKmph)),
    },
    drop: {
      title: dropTitle(order.address),
      city: order.address?.city || null,
      lat: drop?.lat ?? null,
      lng: drop?.lng ?? null,
      // Hub -> drop, the distance the pay is based on.
      distanceKm: pickupToDropKm ?? null,
    },
    totalDistanceKm: toPickupKm !== null && pickupToDropKm != null ? round1(toPickupKm + pickupToDropKm) : null,
    paymentMethod: order.paymentMethod,
    riderLocation: rider,
    respondBy,
    seconds,
    secondsLeft: Math.max(0, Math.round((respondBy - Date.now()) / 1000)),
  };
}

async function context(riderId, override = {}) {
  const [cfg, seconds, profile] = await Promise.all([
    trackingConfig(),
    requestSeconds(),
    DeliveryProfile.findOne({ user: riderId }).select('currentLat currentLng locationUpdatedAt').lean(),
  ]);
  const lat = Number(override.lat);
  const lng = Number(override.lng);
  const given = override.lat !== undefined && override.lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng);
  const rider = given ? { lat, lng } : freshRiderPoint(profile, cfg);
  return { rider, speedKmph: cfg.speedKmph, seconds };
}

const pendingQuery = (riderId, extra = {}) => Order.find({ delivery: riderId, orderStatus: 'assigned', deliveryAcceptedAt: null, ...extra })
  .select('orderNumber store address riderPayQuote tripDistanceKm paymentMethod statusLogs updatedAt')
  .populate('store', 'name address lat lng')
  .populate('address', 'line1 landmark city lat lng');

// GET /delivery/requests?lat=&lng= — lat/lng override the partner's last reported position.
async function pendingRequests(riderId, override = {}) {
  const [orders, ctx] = await Promise.all([pendingQuery(riderId).sort({ updatedAt: 1 }), context(riderId, override)]);
  return orders.map((o) => buildCard(o, ctx.rider, ctx));
}

// Pushes the card to the partner the order was just assigned to. Best effort.
async function pushRequest(orderId) {
  const order = await Order.findById(orderId).select('delivery');
  if (!order?.delivery) return null;
  const riderId = order.delivery.toString();
  const [match] = await pendingQuery(riderId, { _id: orderId });
  if (!match) return null;
  const ctx = await context(riderId);
  const card = buildCard(match, ctx.rider, ctx);
  emitToRooms([ROOMS.user(riderId)], 'delivery:request', card);
  return card;
}

module.exports = { pendingRequests, pushRequest, buildCard };
