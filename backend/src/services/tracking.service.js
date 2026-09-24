const { Order, DeliveryProfile } = require('../models');
const { distanceKm } = require('../utils/geo');
const { getSetting } = require('./settings.service');
const { emitToRooms, ROOMS } = require('../sockets');
const { notifyUser } = require('./notification.service');

// Live delivery tracking: rider GPS -> ETA, geofences, service area and multi-stop route planning.
//
// There's no routing/traffic API behind this — distances are straight-line (haversine) scaled by
// ROAD_FACTOR, at an average speed from the settings. Good enough for "arriving in ~12 min" and
// for ordering a rider's stops; swap travelMinutes() for a Directions API call if you need
// turn-by-turn accuracy.

const ROAD_FACTOR = 1.3; // typical city road distance vs straight line
const num = (v, fallback) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

async function trackingConfig() {
  return {
    speedKmph: num(await getSetting('trackingAvgSpeedKmph', 'TRACKING_AVG_SPEED_KMPH'), 20),
    pickingMinutes: num(await getSetting('trackingPickingMinutes', 'TRACKING_PICKING_MINUTES'), 10),
    handoverMinutes: 2,
    // Used when the rider hasn't been assigned yet / has no fresh GPS fix.
    riderArrivalMinutes: 5,
    // Used for a leg whose end has no coordinates (e.g. an address saved without a location).
    defaultLegMinutes: 15,
    staleAfterMinutes: 10,
    pickupGeofenceM: num(await getSetting('geofencePickupMeters', 'GEOFENCE_PICKUP_METERS'), 100),
    dropGeofenceM: num(await getSetting('geofenceDropMeters', 'GEOFENCE_DROP_METERS'), 100),
    nearbyKm: num(await getSetting('geofenceNearbyKm', 'GEOFENCE_NEARBY_KM'), 1),
  };
}

const hasCoords = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
const point = (o) => (o && hasCoords({ lat: o.lat, lng: o.lng }) ? { lat: o.lat, lng: o.lng } : null);
const km = (a, b) => (hasCoords(a) && hasCoords(b) ? distanceKm(a.lat, a.lng, b.lat, b.lng) : null);
const round1 = (n) => Math.round(n * 10) / 10;

function travelMinutes(distance, cfg) {
  if (distance === null) return cfg.defaultLegMinutes;
  return (distance * ROAD_FACTOR * 60) / cfg.speedKmph;
}

// The rider's last fix, or null if they never reported one or it's too old to trust.
function freshRiderPoint(profile, cfg) {
  if (!profile || !hasCoords({ lat: profile.currentLat, lng: profile.currentLng }) || !profile.locationUpdatedAt) return null;
  if (Date.now() - profile.locationUpdatedAt.getTime() > cfg.staleAfterMinutes * 60 * 1000) return null;
  return { lat: profile.currentLat, lng: profile.currentLng };
}

function minutesSinceStatus(order, status) {
  const log = [...(order.statusLogs || [])].reverse().find((l) => l.status === status);
  const since = log?.createdAt || order.placedAt || order.createdAt;
  return since ? (Date.now() - new Date(since).getTime()) / 60000 : 0;
}

// Estimated delivery for one order. `hub` / `drop` are {lat,lng} or null; `rider` is a fresh
// {lat,lng} or null. Returns null once the order is finished.
//   placed..partially_picked : picking left + rider meets it + handover + hub->drop
//   packed                   : rider arrival + handover + hub->drop
//   assigned                 : rider->hub + handover + hub->drop
//   picked_up/out_for_delivery: rider->drop
function estimateEta(order, { hub, drop, rider }, cfg) {
  const status = order.orderStatus;
  const hubToDrop = km(hub, drop);
  let minutes;
  let remainingKm;

  if (['placed', 'accepted', 'picking', 'partially_picked'].includes(status)) {
    const started = status === 'placed' ? 0 : minutesSinceStatus(order, 'accepted');
    const pickingLeft = Math.max(cfg.pickingMinutes - started, 2) + (status === 'placed' ? 3 : 0);
    minutes = pickingLeft + cfg.handoverMinutes + travelMinutes(hubToDrop, cfg);
    remainingKm = hubToDrop;
  } else if (status === 'packed') {
    minutes = cfg.riderArrivalMinutes + cfg.handoverMinutes + travelMinutes(hubToDrop, cfg);
    remainingKm = hubToDrop;
  } else if (status === 'assigned') {
    const toHub = km(rider, hub);
    const riderLeg = order.arrivedAtPickupAt ? 0 : (toHub === null ? cfg.riderArrivalMinutes : travelMinutes(toHub, cfg));
    minutes = riderLeg + cfg.handoverMinutes + travelMinutes(hubToDrop, cfg);
    remainingKm = toHub !== null && hubToDrop !== null ? toHub + hubToDrop : hubToDrop;
  } else if (['picked_up', 'out_for_delivery'].includes(status)) {
    const toDrop = km(rider, drop) ?? hubToDrop;
    minutes = order.arrivedAtDropAt ? 0 : travelMinutes(toDrop, cfg);
    remainingKm = toDrop;
  } else {
    return null;
  }

  const etaMinutes = Math.max(Math.ceil(minutes), 1);
  return {
    etaMinutes,
    etaAt: new Date(Date.now() + etaMinutes * 60000),
    remainingKm: remainingKm === null || remainingKm === undefined ? null : round1(remainingKm),
    // True when a leg had to be guessed (missing coordinates or no rider GPS yet).
    approximate: !hasCoords(drop) || !hasCoords(hub) || (['assigned', 'picked_up', 'out_for_delivery'].includes(status) && !rider),
  };
}

// Everything a tracking screen needs for one order (customer or admin). Order must have
// store/address populated with lat/lng; rider profile is looked up here.
async function trackingSnapshot(order) {
  const cfg = await trackingConfig();
  const hub = point(order.store);
  const drop = point(order.address);
  const riderId = order.delivery?._id || order.delivery;
  const riderActive = riderId && ['assigned', 'picked_up', 'out_for_delivery'].includes(order.orderStatus);
  const profile = riderActive ? await DeliveryProfile.findOne({ user: riderId }).select('currentLat currentLng locationUpdatedAt') : null;
  const rider = freshRiderPoint(profile, cfg);

  return {
    hub: hub ? { ...hub, name: order.store.name } : null,
    drop,
    rider: rider ? { ...rider, updatedAt: profile.locationUpdatedAt } : null,
    eta: estimateEta(order, { hub, drop, rider }, cfg),
  };
}

const ACTIVE_RIDER_STATUSES = ['assigned', 'picked_up', 'out_for_delivery'];

// Geofences for one active order, given the rider's new position. Saves + notifies as needed.
async function applyGeofences(order, rider, cfg, eta) {
  const hub = point(order.store);
  const drop = point(order.address);
  const now = new Date();
  let changed = false;
  const events = [];

  const toHubM = km(rider, hub);
  if (order.orderStatus === 'assigned' && !order.arrivedAtPickupAt && toHubM !== null && toHubM * 1000 <= cfg.pickupGeofenceM) {
    order.arrivedAtPickupAt = now; // same as POST /delivery/jobs/:id/arrived-pickup
    changed = true;
  }

  const toDrop = km(rider, drop);
  if (['picked_up', 'out_for_delivery'].includes(order.orderStatus) && toDrop !== null) {
    if (!order.nearbyAlertAt && toDrop <= cfg.nearbyKm) {
      order.nearbyAlertAt = now;
      changed = true;
      events.push('rider_nearby');
      await notifyUser(order.customer, {
        title: 'Almost there!',
        body: `Your order ${order.orderNumber} is ${eta ? `about ${eta.etaMinutes} min` : 'a few minutes'} away.`,
        type: 'rider_nearby',
        data: { orderId: order._id },
      });
    }
    if (order.orderStatus === 'out_for_delivery' && !order.arrivedAtDropAt && toDrop * 1000 <= cfg.dropGeofenceM) {
      order.arrivedAtDropAt = now; // same as POST /delivery/jobs/:id/arrived-drop
      changed = true;
      events.push('rider_arrived');
      await notifyUser(order.customer, {
        title: 'Your delivery partner has arrived',
        body: `Order ${order.orderNumber} is at your door. Keep your delivery PIN ready.`,
        type: 'rider_arrived',
        data: { orderId: order._id },
      });
    }
  }

  if (changed) await order.save();
  // Delivery alert calls (IVR) — best effort, never blocks tracking. Required lazily: ivr.service
  // depends on order data this module also touches.
  for (const event of events) {
    require('./ivr.service').triggerOrderEvent(order, event).catch((err) => console.error('IVR alert failed:', err.message));
  }
}

// A delivery partner reported their position (POST /delivery/location or the 'delivery:location'
// socket event). Stores it, runs geofences on their active orders and pushes the new position +
// ETA to whoever is tracking those orders. Returns the updated profile.
async function handleRiderLocation(userId, lat, lng) {
  lat = Number(lat);
  lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const profile = await DeliveryProfile.findOneAndUpdate(
    { user: userId },
    { $set: { currentLat: lat, currentLng: lng, locationUpdatedAt: new Date() } },
    { new: true },
  );
  if (!profile) return null;

  const cfg = await trackingConfig();
  const rider = { lat, lng };
  const orders = await Order.find({ delivery: userId, orderStatus: { $in: ACTIVE_RIDER_STATUSES } })
    .populate('store', 'name lat lng')
    .populate('address', 'lat lng');

  for (const order of orders) {
    const eta = estimateEta(order, { hub: point(order.store), drop: point(order.address), rider }, cfg);
    await applyGeofences(order, rider, cfg, eta);
    const payload = { orderId: order.id, lat, lng, updatedAt: profile.locationUpdatedAt, eta };
    emitToRooms([ROOMS.order(order.id), ROOMS.user(order.customer.toString())], 'delivery:location', payload);
  }

  // Admin live map: full-access admins and the managers of each hub the rider is working for.
  const hubRooms = [...new Set(orders.map((o) => ROOMS.store(o.store._id.toString())))];
  emitToRooms([ROOMS.allOrders, ...hubRooms], 'rider:location', {
    riderId: userId.toString(),
    lat,
    lng,
    updatedAt: profile.locationUpdatedAt,
    orders: orders.map((o) => ({ orderId: o.id, orderNumber: o.orderNumber, orderStatus: o.orderStatus })),
  });

  return profile;
}

// ---- Service area -----------------------------------------------------------------------------

// Which of `stores` can't deliver to `address`. A store with no coordinates, or an address saved
// without a location, can't be checked and is allowed through (`unverified: true`).
async function checkServiceArea(stores, address) {
  const fallback = num(await getSetting('defaultServiceRadiusKm', 'DEFAULT_SERVICE_RADIUS_KM'), null);
  const drop = point(address);
  const outside = [];
  let unverified = false;

  for (const store of stores) {
    const radius = store.serviceRadiusKm ?? fallback;
    if (radius === null || radius === undefined) continue;
    const distance = km(point(store), drop);
    if (distance === null) { unverified = true; continue; }
    if (distance > radius) outside.push({ storeId: store._id, storeName: store.name, distanceKm: round1(distance), radiusKm: radius });
  }
  return { serviceable: outside.length === 0, outside, unverified };
}

// ---- Route optimisation -----------------------------------------------------------------------

// Orders a rider's stops: every hub they still have to collect from, and every drop. A drop can
// only come after the pickup of its order. Greedy nearest-feasible-stop, then 2-opt swaps that
// keep every pickup before its drops. `start` is the rider's position (may be null).
function planStops(start, stops) {
  const legKm = (a, b) => km(a, b) ?? 0;
  const feasible = (seq) => {
    const seen = new Set();
    for (const s of seq) {
      if (s.type === 'pickup') s.orderIds.forEach((id) => seen.add(id));
      else if (s.needsPickup && !seen.has(s.orderIds[0])) return false;
    }
    return true;
  };
  const cost = (seq) => seq.reduce((sum, s, i) => sum + legKm(i === 0 ? start : seq[i - 1], s), 0);

  // Greedy
  const remaining = [...stops];
  const seq = [];
  const picked = new Set();
  let pos = start;
  while (remaining.length) {
    let best = -1;
    let bestD = Infinity;
    remaining.forEach((s, i) => {
      if (s.type === 'drop' && s.needsPickup && !picked.has(s.orderIds[0])) return;
      const d = hasCoords(pos) && hasCoords(s) ? legKm(pos, s) : 0;
      if (d < bestD) { bestD = d; best = i; }
    });
    const [next] = remaining.splice(best, 1);
    if (next.type === 'pickup') next.orderIds.forEach((id) => picked.add(id));
    seq.push(next);
    pos = hasCoords(next) ? next : pos;
  }

  // 2-opt
  let improved = true;
  let current = seq;
  let currentCost = cost(current);
  for (let pass = 0; improved && pass < 20; pass++) {
    improved = false;
    for (let i = 0; i < current.length - 1; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const candidate = [...current.slice(0, i), ...current.slice(i, j + 1).reverse(), ...current.slice(j + 1)];
        if (!feasible(candidate)) continue;
        const c = cost(candidate);
        if (c + 1e-9 < currentCost) { current = candidate; currentCost = c; improved = true; }
      }
    }
  }
  return current;
}

// GET /delivery/route: the rider's active orders as an ordered list of stops with leg distances
// and arrival estimates, plus a Google Maps directions link for the whole trip.
async function planRiderRoute(userId, override = {}) {
  const cfg = await trackingConfig();
  const profile = await DeliveryProfile.findOne({ user: userId });
  const start = hasCoords({ lat: Number(override.lat), lng: Number(override.lng) })
    ? { lat: Number(override.lat), lng: Number(override.lng) }
    : freshRiderPoint(profile, cfg);

  const orders = await Order.find({ delivery: userId, orderStatus: { $in: ACTIVE_RIDER_STATUSES } })
    .populate('store', 'name address lat lng')
    .populate('address', 'line1 landmark city pincode lat lng');

  const pickups = new Map(); // hubId -> stop
  const drops = [];
  const unplanned = [];
  for (const o of orders) {
    const needsPickup = o.orderStatus === 'assigned';
    if (needsPickup) {
      const hubId = o.store._id.toString();
      if (!pickups.has(hubId)) {
        pickups.set(hubId, { type: 'pickup', hubId, label: o.store.name, address: o.store.address, ...point(o.store), orderIds: [], orderNumbers: [] });
      }
      pickups.get(hubId).orderIds.push(o.id);
      pickups.get(hubId).orderNumbers.push(o.orderNumber);
    }
    const drop = point(o.address);
    const address = [o.address?.line1, o.address?.landmark, o.address?.city, o.address?.pincode].filter(Boolean).join(', ');
    if (!drop) { unplanned.push({ orderId: o.id, orderNumber: o.orderNumber, address, reason: 'Address has no location' }); continue; }
    drops.push({ type: 'drop', label: `Deliver ${o.orderNumber}`, address, ...drop, orderIds: [o.id], orderNumbers: [o.orderNumber], needsPickup });
  }

  const plannable = [...[...pickups.values()].filter(hasCoords), ...drops];
  [...pickups.values()].filter((p) => !hasCoords(p)).forEach((p) => {
    unplanned.push({ orderId: p.orderIds.join(','), orderNumber: p.orderNumbers.join(', '), address: p.address, reason: 'Hub has no location' });
    // Their drops can't be ordered after an unknown pickup either — plan them anyway, unconstrained.
    drops.filter((d) => p.orderIds.includes(d.orderIds[0])).forEach((d) => { d.needsPickup = false; });
  });

  const ordered = planStops(start, plannable);
  let prev = start;
  let totalKm = 0;
  let clock = Date.now();
  const stops = ordered.map((s, i) => {
    const leg = km(prev, s);
    totalKm += leg ?? 0;
    clock += (travelMinutes(leg ?? 0, cfg) + (s.type === 'pickup' ? cfg.handoverMinutes : 1)) * 60000;
    prev = s;
    return {
      sequence: i + 1,
      type: s.type,
      label: s.label,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      orderIds: s.orderIds,
      orderNumbers: s.orderNumbers,
      legKm: leg === null ? null : round1(leg),
      arriveBy: new Date(clock),
    };
  });

  let googleMapsUrl = null;
  if (stops.length) {
    const fmt = (p) => `${p.lat},${p.lng}`;
    const params = new URLSearchParams({ api: '1', destination: fmt(stops[stops.length - 1]), travelmode: 'driving' });
    if (start) params.set('origin', fmt(start));
    if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).map(fmt).join('|'));
    googleMapsUrl = `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  return {
    start,
    stops,
    unplanned,
    totalKm: round1(totalKm),
    totalMinutes: stops.length ? Math.ceil((clock - Date.now()) / 60000) : 0,
    googleMapsUrl,
  };
}

module.exports = {
  trackingConfig,
  estimateEta,
  trackingSnapshot,
  handleRiderLocation,
  checkServiceArea,
  planStops,
  planRiderRoute,
  freshRiderPoint,
};
