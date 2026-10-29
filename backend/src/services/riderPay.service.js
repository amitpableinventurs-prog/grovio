const mongoose = require('mongoose');
const { DeliveryTrip, Order, DeliveryProfile, Store, Product, Setting, RiderPayPeriod, RiderSession, WalletTransaction } = require('../models');
const ApiError = require('../utils/apiError');
const t = require('../utils/localTime');
const { getSetting, invalidateSettingsCache } = require('./settings.service');
const sessions = require('./riderSession.service');
const { logServerError } = require('./errorLog.service');

// GoGrovio delivery partner pay: KM earning + performance incentives.
//
//   Total earning = KM base + daily incentive + weekly incentive + peak + rain + heavy load
//                   + waiting / cancellation pay + eligible minimum-guarantee top-up
//
// Per order — paid with its trip once every order of the trip is finished (trip lifecycle below):
//   KM base      slab for the hub -> drop mapped distance; each order of a multi-order trip has its
//                own. The order's value never changes it.
//   peak         flat ₹ per delivery inside the peak windows, or the high-surge amount while the hub
//                is on high surge (Store.riderConditions)
//   rain         by the hub's rain level (normal / heavy / severe), set by an admin
//   heavy load   by the order's weight (Product.weightKg x qty)
//   waiting      per minute beyond the free minutes at the hub (once per trip) and at the door
//   cancellation when an order is cancelled (not by the partner) after they reached the hub
// A quote is saved on the order when it's assigned (order.riderPayQuote) so the app shows the
// mapped distance, KM pay, bonuses and estimated total before accepting. Final pay is never below
// what was quoted.
//
// Per day / week (settlePeriod, once the period is over + settleDelayHours): daily slab (Bronze …
// Diamond tiers), weekly slab and the minimum-guarantee top-up, only when the partner is eligible
// (cancellation rate, not withheld by an admin for fraud / a verified complaint). Kept as a
// RiderPayPeriod with its figures, eligibility, payout status and audit log.
//
// Every number lives in the `riderPayPolicy` setting (GET/PUT /admin/rider-pay/policy); a partner
// can have their own values on top (DeliveryProfile.payOverride).

const DEFAULT_POLICY = {
  // First slab whose upToKm covers the distance; past the last one, its amount + perKmBeyond for
  // every started km beyond it.
  kmSlabs: [
    { upToKm: 1, amount: 12 }, { upToKm: 2, amount: 15 }, { upToKm: 3, amount: 22 }, { upToKm: 4, amount: 30 },
    { upToKm: 5, amount: 38 }, { upToKm: 6, amount: 46 }, { upToKm: 7, amount: 54 }, { upToKm: 8, amount: 62 },
    { upToKm: 9, amount: 70 }, { upToKm: 10, amount: 78 },
  ],
  perKmBeyond: 8,
  peak: { amount: 5, highSurgeAmount: 10, windows: [{ from: '07:00', to: '10:00' }, { from: '18:00', to: '22:00' }] },
  rain: { normal: 5, heavy: 10, severe: 15 },
  heavyLoad: [{ minKg: 10, amount: 5 }, { minKg: 20, amount: 10 }, { minKg: 30, amount: 15 }],
  // Off until perMinute is set. maxPay null = no cap.
  waiting: { freeMinutes: 10, perMinute: 0, maxPay: null },
  // Off until set: an order cancelled after the partner reached the hub / picked it up.
  cancellation: { arrivedAtPickup: 0, pickedUp: 0 },
  // Highest slab reached; tier is the performance tier name shown in the app.
  daily: [
    { deliveries: 5, amount: 20, tier: null }, { deliveries: 10, amount: 50, tier: 'Bronze' },
    { deliveries: 15, amount: 100, tier: 'Silver' }, { deliveries: 20, amount: 175, tier: 'Gold' },
    { deliveries: 25, amount: 275, tier: 'Platinum' }, { deliveries: 30, amount: 400, tier: 'Diamond' },
    { deliveries: 35, amount: 550, tier: 'Diamond' }, { deliveries: 40, amount: 700, tier: 'Diamond' },
  ],
  weekly: [
    { deliveries: 60, amount: 150 }, { deliveries: 90, amount: 300 }, { deliveries: 120, amount: 500 },
    { deliveries: 150, amount: 750 }, { deliveries: 180, amount: 1000 }, { deliveries: 210, amount: 1300 },
  ],
  // Daily minimum for an eligible shift: the higher of this and the day's calculated earning.
  guarantee: { enabled: false, amount: 300, minOnlineMinutes: 480, minDeliveries: 8, requireGig: false },
  // Incentives need a cancellation rate (my hand-backs after accepting / (delivered + those)) at
  // most maxCancellationRatePct — checked once there are at least minOrdersForRate of them.
  eligibility: { maxCancellationRatePct: 10, minOrdersForRate: 5 },
  // Days / weeks are settled this long after they end (time to flag fraud or complaints).
  settleDelayHours: 12,
};

const RAIN_LEVELS = ['none', 'normal', 'heavy', 'severe'];
const SURGE_LEVELS = ['none', 'high'];
const FINAL = ['delivered', 'cancelled', 'returned', 'delivery_failed'];
const HHMM = /^\d{2}:\d{2}$/;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isPlainObject(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) && isPlainObject(base[k]) ? merge(base[k], v) : v;
  return out;
}
// Only the policy's own sections (older overrides held base / perKm / … — ignored now).
function policyPart(o) {
  if (!isPlainObject(o)) return null;
  const out = Object.fromEntries(Object.entries(o).filter(([k]) => k in DEFAULT_POLICY));
  return Object.keys(out).length ? out : null;
}

// ---- Policy ----------------------------------------------------------------------------------

async function globalPolicy() {
  try {
    const raw = await getSetting('riderPayPolicy');
    return merge(DEFAULT_POLICY, policyPart(raw ? JSON.parse(raw) : null));
  } catch {
    return DEFAULT_POLICY;
  }
}

// Effective policy: default -> the partner's own values. `level` says which applied (audit).
async function getPolicy(riderId = null) {
  const base = await globalPolicy();
  if (!riderId) return { ...base, level: 'default' };
  const profile = await DeliveryProfile.findOne({ user: riderId }).select('payOverride').lean();
  const own = policyPart(profile?.payOverride);
  return own ? { ...merge(base, own), level: 'partner' } : { ...base, level: 'default' };
}

// Checks a policy change / override: known sections only, no negative amounts, sane tables.
function validatePolicyPatch(patch) {
  if (!isPlainObject(patch)) throw new ApiError(422, 'Send the policy parts to change as an object');
  const unknown = Object.keys(patch).filter((k) => !(k in DEFAULT_POLICY));
  if (unknown.length) throw new ApiError(422, `Unknown policy section(s): ${unknown.join(', ')}`);
  const walk = (v, where) => {
    if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) throw new ApiError(422, `${where} must be 0 or more`);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (isPlainObject(v)) Object.entries(v).forEach(([k, x]) => walk(x, `${where}.${k}`));
  };
  walk(patch, 'policy');
  const table = (key, field) => {
    if (patch[key] === undefined) return;
    if (!Array.isArray(patch[key]) || patch[key].some((r) => !isPlainObject(r) || !(Number(r[field]) >= 0) || !(Number(r.amount) >= 0))) {
      throw new ApiError(422, `${key}: [{ ${field}, amount }]`);
    }
  };
  table('kmSlabs', 'upToKm');
  table('heavyLoad', 'minKg');
  table('daily', 'deliveries');
  table('weekly', 'deliveries');
  if (patch.kmSlabs && !patch.kmSlabs.length) throw new ApiError(422, 'kmSlabs needs at least one slab');
  if (patch.kmSlabs && patch.kmSlabs.some((s) => !(Number(s.upToKm) > 0))) throw new ApiError(422, 'kmSlabs: upToKm must be above 0');
  if (patch.peak?.windows && (!Array.isArray(patch.peak.windows) || patch.peak.windows.some((w) => !HHMM.test(w?.from) || !HHMM.test(w?.to)))) {
    throw new ApiError(422, 'peak.windows: [{ from: "HH:mm", to: "HH:mm" }]');
  }
  if (patch.rain) {
    const bad = Object.keys(patch.rain).filter((k) => !RAIN_LEVELS.includes(k) || k === 'none');
    if (bad.length) throw new ApiError(422, `Unknown rain level(s): ${bad.join(', ')}`);
  }
  if (patch.guarantee?.enabled !== undefined && typeof patch.guarantee.enabled !== 'boolean') throw new ApiError(422, 'guarantee.enabled must be true or false');
  if (patch.guarantee?.requireGig !== undefined && typeof patch.guarantee.requireGig !== 'boolean') throw new ApiError(422, 'guarantee.requireGig must be true or false');
  return patch;
}

// Keep tables sorted so "slab reached" logic stays simple.
function sortTables(p) {
  const by = (key, field) => { if (Array.isArray(p[key])) p[key] = [...p[key]].map((r) => ({ ...r, [field]: Number(r[field]), amount: Number(r.amount) })).sort((a, b) => a[field] - b[field]); };
  by('kmSlabs', 'upToKm');
  by('heavyLoad', 'minKg');
  by('daily', 'deliveries');
  by('weekly', 'deliveries');
  if (Array.isArray(p.daily)) p.daily = p.daily.map((s) => ({ ...s, tier: s.tier ? String(s.tier) : null }));
  return p;
}

async function savePolicy(changes) {
  const merged = sortTables(merge(await globalPolicy(), validatePolicyPatch(changes)));
  await Setting.findOneAndUpdate({ key: 'riderPayPolicy' }, { value: JSON.stringify(merged) }, { upsert: true });
  invalidateSettingsCache();
  return merged;
}

// PUT /admin/delivery-partners/:id/pay — merged into the partner's own values; null clears them.
async function setRiderOverride(riderId, patch) {
  const profile = await DeliveryProfile.findOne({ user: riderId }).select('payOverride');
  if (!profile) throw new ApiError(404, 'Delivery partner not found');
  profile.payOverride = patch === null ? null : sortTables(merge(policyPart(profile.payOverride) || {}, validatePolicyPatch(patch)));
  profile.markModified('payOverride');
  await profile.save();
  return profile.payOverride;
}

// ---- Per order -------------------------------------------------------------------------------

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
// Windows may run past midnight, e.g. 22:00-06:00.
function inWindows(windows, at) {
  const m = t.localMinutes(at);
  return (windows || []).some((w) => { const a = toMin(w.from); const b = toMin(w.to); return a <= b ? m >= a && m < b : m >= a || m < b; });
}
const tierAmount = (tiers, value, key) => (tiers || []).reduce((amt, tier) => (value >= tier[key] ? tier.amount : amt), 0);

// KM base pay for a distance: { amount, slab: '2–3 km' }.
function kmBase(policy, km) {
  const d = Math.max(0, Number(km) || 0);
  let from = 0;
  for (const s of policy.kmSlabs) {
    if (d <= s.upToKm) return { amount: round2(s.amount), slab: `${from}–${s.upToKm} km` };
    from = s.upToKm;
  }
  const last = policy.kmSlabs[policy.kmSlabs.length - 1];
  const extraKm = Math.ceil(round2(d - last.upToKm));
  return { amount: round2(last.amount + extraKm * policy.perKmBeyond), slab: `${last.upToKm} km+ (${extraKm} km × ₹${policy.perKmBeyond})` };
}

// A hub's weather / surge at a moment (Store.riderConditions), none outside [since, until).
function activeConditions(store, at = new Date()) {
  const c = store?.riderConditions;
  const when = new Date(at);
  if (!c || (c.since && new Date(c.since) > when) || (c.until && new Date(c.until) <= when)) return { rain: 'none', surge: 'none' };
  return { rain: RAIN_LEVELS.includes(c.rain) ? c.rain : 'none', surge: SURGE_LEVELS.includes(c.surge) ? c.surge : 'none' };
}

function bonuses(policy, { at, conditions, weightKg }) {
  const peak = inWindows(policy.peak.windows, at) ? policy.peak.amount : 0;
  const surge = conditions.surge === 'high' ? policy.peak.highSurgeAmount : 0;
  return {
    peakBonus: round2(Math.max(peak, surge)),
    rainBonus: conditions.rain !== 'none' ? round2(policy.rain[conditions.rain] || 0) : 0,
    heavyLoadBonus: weightKg ? round2(tierAmount(policy.heavyLoad, weightKg, 'minKg')) : 0,
  };
}

// What one order will pay, as shown before accepting. Pure.
function quote(policy, { km, distanceSource = 'estimate', weightKg = null, at = new Date(), conditions = { rain: 'none', surge: 'none' } }) {
  const base = kmBase(policy, km);
  const b = bonuses(policy, { at, conditions, weightKg });
  return {
    mappedDistanceKm: km === null || km === undefined ? null : round2(km),
    distanceSource,
    kmSlab: base.slab,
    basePayout: base.amount,
    ...b,
    weightKg,
    rain: conditions.rain,
    surge: conditions.surge,
    total: round2(base.amount + b.peakBonus + b.rainBonus + b.heavyLoadBonus),
    rates: policy.level || 'default',
    quotedAt: new Date(at),
  };
}

// Order weight from product (or variant) weights x qty; null when none of its products has one.
async function orderWeightKg(order) {
  const items = (order.items || []).filter((i) => i.isAvailable !== false);
  if (!items.length) return null;
  const products = await Product.find({ _id: { $in: items.map((i) => i.product) } }).select('weightKg variants._id variants.weightKg').lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  let known = false;
  let kg = 0;
  for (const i of items) {
    const p = byId.get(String(i.product));
    const v = i.variantId ? p?.variants?.find((x) => String(x._id) === String(i.variantId)) : null;
    const w = v?.weightKg ?? p?.weightKg;
    if (w === null || w === undefined) continue;
    known = true;
    kg += Number(w) * Number(i.pickedQty ?? i.qty);
  }
  return known ? round2(kg) : null;
}

// Mapped hub -> drop distance (Google Routes when configured, else the road estimate) and the
// quote, saved on the order when it's assigned.
async function quoteOrder(order, riderId) {
  const o = await Order.findById(order._id).select('store address items').populate('store', 'lat lng riderConditions').populate('address', 'lat lng').lean();
  if (!o) return null;
  const [policy, route, weightKg] = await Promise.all([
    getPolicy(riderId),
    require('./directions.service').route(o.store, o.address).catch(() => null),
    orderWeightKg(o),
  ]);
  const now = new Date();
  const q = quote(policy, {
    km: route ? route.distanceKm : null,
    distanceSource: route ? route.source : 'unknown',
    weightKg,
    at: now,
    conditions: activeConditions(o.store, now),
  });
  await Order.updateOne({ _id: o._id }, { $set: { riderPayQuote: q, weightKg } });
  order.riderPayQuote = q;
  order.weightKg = weightKg;
  return q;
}

const billable = (policy, minutes) => Math.max(0, (Number(minutes) || 0) - policy.waiting.freeMinutes);
const minutesBetween = (a, b) => (a && b && new Date(b) > new Date(a) ? (new Date(b) - new Date(a)) / 60000 : 0);

// Pay for a finished trip's orders. Pure — see completeTripIfDone.
//   conditions(at) -> the hub's { rain, surge } then; estimateKm(order) -> road estimate when the
//   order has no quote (assigned before quotes existed).
function computeTripPay(policy, orders, { conditions = () => ({ rain: 'none', surge: 'none' }), estimateKm = () => null } = {}) {
  const delivered = orders.filter((o) => o.orderStatus === 'delivered');
  // Waiting at the hub is shared by the trip's orders: the longest wait, paid once, with the
  // first delivered order.
  const hubWait = Math.max(0, ...orders.map((o) => minutesBetween(o.arrivedAtPickupAt, o.pickerHandoverAt)));
  const hubWaitOrder = delivered[0] ? String(delivered[0]._id) : null;

  const perOrder = new Map();
  for (const o of orders) {
    const q = o.riderPayQuote || null;
    const row = {
      status: o.orderStatus, mappedDistanceKm: null, distanceSource: null, kmSlab: null, basePayout: 0,
      peakBonus: 0, rainBonus: 0, heavyLoadBonus: 0, weightKg: q?.weightKg ?? o.weightKg ?? null,
      waitingMinutes: 0, waitingPay: 0, cancellationPay: 0, total: 0, rates: policy.level || 'default',
    };
    if (o.orderStatus === 'delivered') {
      const km = q ? q.mappedDistanceKm ?? estimateKm(o) : estimateKm(o);
      const base = kmBase(policy, km);
      const at = o.deliveredAt || new Date();
      const now = bonuses(policy, { at, conditions: conditions(at), weightKg: row.weightKg });
      row.mappedDistanceKm = km === null || km === undefined ? null : round2(km);
      row.distanceSource = q?.distanceSource || 'estimate';
      row.kmSlab = base.amount >= (q?.basePayout || 0) ? base.slab : q.kmSlab;
      // Never below what the app showed before accepting.
      row.basePayout = round2(Math.max(base.amount, q?.basePayout || 0));
      row.peakBonus = round2(Math.max(now.peakBonus, q?.peakBonus || 0));
      row.rainBonus = round2(Math.max(now.rainBonus, q?.rainBonus || 0));
      row.heavyLoadBonus = round2(Math.max(now.heavyLoadBonus, q?.heavyLoadBonus || 0));
      const doorWait = minutesBetween(o.arrivedAtDropAt, o.deliveredAt);
      const hub = String(o._id) === hubWaitOrder ? hubWait : 0;
      row.waitingMinutes = Math.round(doorWait + hub);
      const pay = (billable(policy, doorWait) + billable(policy, hub)) * policy.waiting.perMinute;
      row.waitingPay = round2(policy.waiting.maxPay === null || policy.waiting.maxPay === undefined ? pay : Math.min(pay, policy.waiting.maxPay));
    } else if (o.orderStatus === 'cancelled') {
      // Still on the trip = cancelled by the customer / customer care, not handed back by me.
      row.cancellationPay = round2(o.pickerHandoverAt ? policy.cancellation.pickedUp : o.arrivedAtPickupAt ? policy.cancellation.arrivedAtPickup : 0);
    }
    row.total = round2(row.basePayout + row.peakBonus + row.rainBonus + row.heavyLoadBonus + row.waitingPay + row.cancellationPay);
    perOrder.set(String(o._id), row);
  }

  const sum = (key) => round2([...perOrder.values()].reduce((s, r) => s + r[key], 0));
  const lines = [
    ['order_pay', 'Order pay (KM)', sum('basePayout')],
    ['peak_pay', 'Peak incentive', sum('peakBonus')],
    ['rain_pay', 'Rain incentive', sum('rainBonus')],
    ['heavy_load_pay', 'Heavy load bonus', sum('heavyLoadBonus')],
    ['waiting_pay', 'Waiting pay', sum('waitingPay')],
    ['cancellation_pay', 'Cancellation pay', sum('cancellationPay')],
  ].filter(([key, , amount]) => amount > 0 || key === 'order_pay').map(([key, label, amount]) => ({ key, label, amount }));
  return {
    total: sum('total'),
    lines,
    perOrder,
    distanceKm: round2(delivered.reduce((s, o) => s + (perOrder.get(String(o._id)).mappedDistanceKm || 0), 0)),
    deliveredOrders: delivered.length,
  };
}

// ---- Trip lifecycle (called from order.service.js#transitionOrder) ---------------------------

async function detachFromTrip(order) {
  if (!order.trip) return;
  const tripId = order.trip;
  await DeliveryTrip.updateOne({ _id: tripId }, { $pull: { orders: order._id } });
  await Order.updateOne({ _id: order._id }, { $set: { trip: null, riderPayQuote: null } });
  order.trip = null;
  order.riderPayQuote = null;
  const trip = await DeliveryTrip.findById(tripId);
  if (trip && !trip.orders.length && trip.status !== 'completed') await trip.deleteOne();
  else if (trip) await completeTripIfDone(tripId);
}

// Order assigned to a partner: join (or open) their trip at this hub, and quote its pay.
async function attachToTrip(order) {
  if (!order.delivery) return null;
  if (order.trip) {
    const current = await DeliveryTrip.findById(order.trip).select('rider status');
    if (current && String(current.rider) === String(order.delivery) && current.status !== 'completed') return current;
    await detachFromTrip(order);
  }
  const trip = await DeliveryTrip.findOneAndUpdate(
    { rider: order.delivery, store: order.store, status: 'open' },
    { $addToSet: { orders: order._id }, $setOnInsert: { rider: order.delivery, store: order.store, status: 'open' } },
    { upsert: true, new: true },
  );
  await Order.updateOne({ _id: order._id }, { $set: { trip: trip._id } });
  order.trip = trip._id;
  try {
    await quoteOrder(order, order.delivery);
  } catch (err) {
    logServerError(`Pay quote for ${order.orderNumber} failed`, err);
  }
  return trip;
}

// First order leaves the hub: no more orders join this trip.
async function startTrip(order) {
  if (!order.trip) return;
  await DeliveryTrip.updateOne({ _id: order.trip, status: 'open' }, { $set: { status: 'started', startedAt: new Date() } });
}

const POCKET_LINES = [
  ['basePayout', 'order_earning', null],
  ['peakBonus', 'incentive', 'Peak incentive'],
  ['rainBonus', 'incentive', 'Rain incentive'],
  ['heavyLoadBonus', 'incentive', 'Heavy load bonus'],
  ['waitingPay', 'other_earning', 'Waiting pay'],
  ['cancellationPay', 'other_earning', 'Cancellation pay'],
];

// Once every order of the trip is finished: work out the pay, store it on the orders and credit it.
async function completeTripIfDone(tripId) {
  if (!tripId) return null;
  const trip = await DeliveryTrip.findById(tripId);
  if (!trip || trip.status === 'completed' || !trip.orders.length) return null;
  const orders = await Order.find({ _id: { $in: trip.orders } })
    .select('orderNumber orderStatus deliveredAt delivery deliveryPartnerEarning deliveryFee tripDistanceKm store address riderPayQuote weightKg arrivedAtPickupAt pickerHandoverAt arrivedAtDropAt')
    .populate('store', 'lat lng riderConditions')
    .populate('address', 'lat lng');
  if (!orders.every((o) => FINAL.includes(o.orderStatus))) return null;

  // Claim it so it's paid exactly once.
  const claimed = await DeliveryTrip.findOneAndUpdate({ _id: trip._id, status: { $ne: 'completed' } }, { $set: { status: 'completed', completedAt: new Date() } }, { new: true });
  if (!claimed) return null;

  const { tripKm } = require('./riderEarnings.service');
  const policy = await getPolicy(trip.rider);
  const hub = orders[0]?.store;
  const result = computeTripPay(policy, orders, { conditions: (at) => activeConditions(hub, at), estimateKm: (o) => tripKm(o) });

  const paidAt = new Date();
  await Promise.all(orders.map((o) => Order.updateOne({ _id: o._id }, { $set: { riderPay: { ...result.perOrder.get(String(o._id)), paidAt } } })));
  claimed.pay = {
    total: result.total,
    lines: result.lines,
    distanceKm: result.distanceKm,
    deliveredOrders: result.deliveredOrders,
    rates: policy.level || 'default',
    paidAt,
  };
  if (!claimed.startedAt) claimed.startedAt = claimed.completedAt;
  await claimed.save();

  // Pocket entries per order: Trip Earning (KM pay), then each bonus as its own line.
  const pocket = require('./pocket.service');
  for (const o of orders) {
    const share = result.perOrder.get(String(o._id));
    for (const [key, category, title] of POCKET_LINES) {
      if (share[key] > 0) await pocket.post({ userId: trip.rider, type: 'credit', amount: share[key], category, title, reason: title || undefined, refOrderId: o._id });
    }
  }
  return claimed;
}

// transitionOrder hook: keep trips in step with order status.
async function onOrderStatus(order, toStatus) {
  if (toStatus === 'assigned') await attachToTrip(order);
  else if (toStatus === 'out_for_delivery') await startTrip(order);
  else if (FINAL.includes(toStatus) && order.trip) await completeTripIfDone(order.trip);
}

// ---- Hub conditions (rain / surge) ------------------------------------------------------------

function conditionsView(store, now = new Date()) {
  const c = store.riderConditions || {};
  const active = activeConditions(store, now);
  return { storeId: store._id, storeName: store.name, rain: c.rain || 'none', surge: c.surge || 'none', since: c.since || null, until: c.until || null, active, updatedAt: c.updatedAt || null };
}

async function listConditions() {
  const stores = await Store.find({ status: 'active' }).select('name riderConditions').sort({ name: 1 }).lean();
  return stores.map((s) => conditionsView(s));
}

// PUT /admin/stores/:id/rider-conditions { rain, surge, until? } — applies to deliveries from now.
async function setConditions(storeId, { rain = 'none', surge = 'none', until = null } = {}, by = null) {
  if (!RAIN_LEVELS.includes(rain)) throw new ApiError(422, `rain must be one of: ${RAIN_LEVELS.join(', ')}`);
  if (!SURGE_LEVELS.includes(surge)) throw new ApiError(422, `surge must be one of: ${SURGE_LEVELS.join(', ')}`);
  const untilAt = until ? new Date(until) : null;
  if (untilAt && (Number.isNaN(untilAt.getTime()) || untilAt <= new Date())) throw new ApiError(422, 'until must be a future date-time');
  const store = await Store.findById(storeId).select('name riderConditions');
  if (!store) throw new ApiError(404, 'Store not found');
  const now = new Date();
  store.riderConditions = rain === 'none' && surge === 'none'
    ? null
    : { rain, surge, since: now, until: untilAt, updatedBy: by, updatedAt: now };
  store.markModified('riderConditions');
  await store.save();
  return conditionsView(store.toObject(), now);
}

// ---- Per day / week --------------------------------------------------------------------------

const slabReached = (slabs, n) => (slabs || []).reduce((hit, s) => (n >= s.deliveries ? s : hit), null);
const slabNext = (slabs, n) => (slabs || []).find((s) => n < s.deliveries) || null;

function periodRange(kind, key) {
  const day = t.parseDateKey(key);
  if (!day) throw new ApiError(422, 'Period key must be a date (YYYY-MM-DD)');
  if (kind === 'day') return { from: day, to: t.addDays(day, 1), label: `${t.dayLabel(day)}, ${t.weekdayLabel(day)}` };
  if (kind === 'week') {
    if (t.dateKey(t.startOfWeek(day)) !== key) throw new ApiError(422, 'A week key must be its Monday (YYYY-MM-DD)');
    return { from: day, to: t.addDays(day, 7), label: `${t.dayLabel(day)} - ${t.dayLabel(t.addDays(day, 6))}` };
  }
  throw new ApiError(422, "kind must be 'day' or 'week'");
}

// Delivered orders, their pay and my hand-backs after accepting, in [from, to).
async function activity(riderId, from, to) {
  const { orderEarning } = require('./riderEarnings.service');
  const [orders, handBacks] = await Promise.all([
    Order.find({ delivery: riderId, orderStatus: 'delivered', deliveredAt: { $gte: from, $lt: to } }).select('orderStatus deliveryPartnerEarning deliveryFee trip riderPay').lean(),
    Order.aggregate([
      { $match: { 'deliveryRejections.rider': oid(riderId) } },
      { $unwind: '$deliveryRejections' },
      { $match: { 'deliveryRejections.rider': oid(riderId), 'deliveryRejections.kind': 'cancellation', 'deliveryRejections.at': { $gte: from, $lt: to } } },
      { $count: 'n' },
    ]),
  ]);
  const deliveries = orders.length;
  const cancellations = handBacks[0]?.n || 0;
  const handled = deliveries + cancellations;
  return {
    deliveries,
    orderEarnings: round2(orders.reduce((s, o) => s + orderEarning(o), 0)),
    // Orders still on a trip that isn't finished aren't paid (or counted in orderEarnings) yet.
    unpaidDeliveries: orders.filter((o) => !o.riderPay && o.trip).length,
    cancellations,
    cancellationRatePct: handled ? round2((cancellations / handled) * 100) : 0,
  };
}

function eligibilityOf(policy, a) {
  const e = policy.eligibility;
  const rateChecked = a.deliveries + a.cancellations >= e.minOrdersForRate;
  const checks = {
    // Every delivered order was closed with the customer's PIN (completeJob), so each is proven.
    deliveryProof: true,
    cancellationRate: !rateChecked || a.cancellationRatePct <= e.maxCancellationRatePct,
  };
  const reasons = checks.cancellationRate ? [] : [`Cancellation rate ${a.cancellationRatePct}% is above ${e.maxCancellationRatePct}%`];
  return { eligible: reasons.length === 0, checks, reasons };
}

// Everything about one day — live for today, final when settled.
async function dayFigures(riderId, key, policy) {
  policy = policy || await getPolicy(riderId);
  const { from, to, label } = periodRange('day', key);
  const [a, onlineMinutes, gigs] = await Promise.all([
    activity(riderId, from, to),
    sessions.onlineMinutes(riderId, from, to),
    require('./gig.service').gigCounts(riderId, from, to),
  ]);
  const slab = slabReached(policy.daily, a.deliveries);
  const next = slabNext(policy.daily, a.deliveries);
  const eligibility = eligibilityOf(policy, a);
  const dailyIncentive = slab ? round2(slab.amount) : 0;

  const g = policy.guarantee;
  const guaranteeChecks = {
    shift: onlineMinutes >= g.minOnlineMinutes && (!g.requireGig || gigs.completed > 0),
    activity: a.deliveries >= g.minDeliveries,
    serviceQuality: eligibility.eligible,
  };
  const guaranteeEligible = !!g.enabled && Object.values(guaranteeChecks).every(Boolean);
  const calculated = round2(a.orderEarnings + dailyIncentive);
  const topUp = guaranteeEligible ? round2(Math.max(0, g.amount - calculated)) : 0;

  const lines = [
    { key: 'daily_incentive', label: slab?.tier ? `Daily incentive · ${slab.tier}` : 'Daily incentive', amount: dailyIncentive },
    { key: 'guarantee_topup', label: 'Minimum guarantee top-up', amount: topUp },
  ];
  return {
    kind: 'day',
    key,
    label,
    rates: policy.level || 'default',
    ...a,
    onlineMinutes,
    onlineHoursLabel: sessions.hhmm(onlineMinutes),
    gigsCompleted: gigs.completed,
    dailySlab: slab ? { deliveries: slab.deliveries, amount: slab.amount, tier: slab.tier || null } : null,
    tier: slab?.tier || null,
    nextSlab: next ? { deliveries: next.deliveries, amount: next.amount, tier: next.tier || null, deliveriesToGo: next.deliveries - a.deliveries } : null,
    eligibility,
    guarantee: { enabled: !!g.enabled, amount: g.amount, eligible: guaranteeEligible, checks: guaranteeChecks, topUp },
    lines,
    incentives: round2(lines.reduce((s, l) => s + l.amount, 0)),
    // Order pay + day incentives (weekly bonus not included).
    total: round2(calculated + topUp),
  };
}

async function weekFigures(riderId, key, policy) {
  policy = policy || await getPolicy(riderId);
  const { from, to, label } = periodRange('week', key);
  const a = await activity(riderId, from, to);
  const slab = slabReached(policy.weekly, a.deliveries);
  const next = slabNext(policy.weekly, a.deliveries);
  const weeklyIncentive = slab ? round2(slab.amount) : 0;
  const lines = [{ key: 'weekly_incentive', label: 'Weekly incentive', amount: weeklyIncentive }];
  return {
    kind: 'week',
    key,
    label,
    rates: policy.level || 'default',
    ...a,
    weeklySlab: slab ? { deliveries: slab.deliveries, amount: slab.amount } : null,
    nextSlab: next ? { deliveries: next.deliveries, amount: next.amount, deliveriesToGo: next.deliveries - a.deliveries } : null,
    eligibility: eligibilityOf(policy, a),
    lines,
    incentives: weeklyIncentive,
    total: round2(a.orderEarnings + weeklyIncentive),
  };
}

const figuresFor = (riderId, kind, key, policy) => (kind === 'day' ? dayFigures(riderId, key, policy) : weekFigures(riderId, key, policy));
const periodOver = (kind, key, now = new Date()) => periodRange(kind, key).to <= now;

// Work out a claimed ('settling') period and credit what's due, once (each line has its refId).
async function finishPeriod(doc, { action, by = null, note = null }) {
  const f = await figuresFor(doc.rider, doc.kind, doc.key);
  const payable = f.eligibility.eligible ? f.lines.filter((l) => l.amount > 0) : [];
  const pocket = require('./pocket.service');
  const description = doc.kind === 'day' ? f.label : `Week of ${f.label}`;
  for (const l of payable) {
    const refId = `rpay:${doc.kind}:${doc.key}:${l.key}`;
    if (!(await WalletTransaction.exists({ user: doc.rider, refId }))) {
      await pocket.post({ userId: doc.rider, type: 'credit', amount: l.amount, category: l.key === 'guarantee_topup' ? 'other_earning' : 'incentive', title: l.label, reason: l.label, description, refId });
    }
  }
  const total = round2(payable.reduce((s, l) => s + l.amount, 0));
  doc.figures = f;
  doc.lines = f.lines;
  doc.eligibility = { status: f.eligibility.eligible ? 'eligible' : 'ineligible', checks: f.eligibility.checks, reasons: f.eligibility.reasons };
  doc.total = total;
  doc.payoutStatus = !f.eligibility.eligible ? 'not_eligible' : total > 0 ? 'paid' : 'nothing_due';
  doc.settledAt = new Date();
  doc.audit.push({ action, by, note, amount: total });
  await doc.save();
  return doc;
}

// Settle one partner's finished day / week. A withheld period only gets its figures (for review).
async function settlePeriod(riderId, kind, key) {
  if (!periodOver(kind, key)) return null;
  const where = { rider: riderId, kind, key };
  try {
    await RiderPayPeriod.updateOne(where, { $setOnInsert: { ...where, payoutStatus: 'pending' } }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  const held = await RiderPayPeriod.findOne({ ...where, payoutStatus: 'withheld', figures: null });
  if (held) {
    const f = await figuresFor(riderId, kind, key);
    held.figures = f;
    held.lines = f.lines;
    held.eligibility = { status: f.eligibility.eligible ? 'eligible' : 'ineligible', checks: f.eligibility.checks, reasons: f.eligibility.reasons };
    held.audit.push({ action: 'calculated', note: 'Figures worked out; payout stays withheld' });
    await held.save();
    return held;
  }
  // Claim it (or retry one stuck mid-way for over an hour) so it's settled once.
  const doc = await RiderPayPeriod.findOneAndUpdate(
    { ...where, $or: [{ payoutStatus: 'pending' }, { payoutStatus: 'settling', updatedAt: { $lt: new Date(Date.now() - 3600000) } }] },
    { $set: { payoutStatus: 'settling' } },
    { new: true },
  );
  if (!doc) return null;
  return finishPeriod(doc, { action: 'settled' });
}

// Admin: hold back a period's incentives (GPS / payment manipulation, verified complaint, …).
async function withholdPeriod(riderId, kind, key, { reason, by = null }) {
  periodRange(kind, key);
  if (!reason || !String(reason).trim()) throw new ApiError(422, 'Give a reason for withholding');
  const where = { rider: riderId, kind, key };
  const existing = await RiderPayPeriod.findOne(where);
  if (existing && existing.payoutStatus !== 'pending') {
    const why = { withheld: 'Already withheld', settling: 'Being settled right now — try again in a minute', paid: 'Already paid — add a deduction instead' };
    throw new ApiError(400, why[existing.payoutStatus] || `Already settled (${existing.payoutStatus.replace(/_/g, ' ')})`);
  }
  const entry = { action: 'withheld', by, note: String(reason).trim() };
  const withheld = { reason: String(reason).trim(), by, at: new Date() };
  if (existing) {
    existing.payoutStatus = 'withheld';
    existing.withheld = withheld;
    existing.audit.push(entry);
    return existing.save();
  }
  return RiderPayPeriod.create({ ...where, payoutStatus: 'withheld', withheld, audit: [entry] });
}

// Admin: lift a withhold — paid now if the period is over, else settled normally when it is.
async function releasePeriod(riderId, kind, key, { note = null, by = null } = {}) {
  const over = periodOver(kind, key);
  const doc = await RiderPayPeriod.findOneAndUpdate(
    { rider: riderId, kind, key, payoutStatus: 'withheld' },
    { $set: { payoutStatus: over ? 'settling' : 'pending', withheld: null } },
    { new: true },
  );
  if (!doc) throw new ApiError(400, 'This period is not withheld');
  if (!over) {
    doc.audit.push({ action: 'released', by, note });
    return doc.save();
  }
  return finishPeriod(doc, { action: 'released', by, note });
}

// Background job: settle finished days (last 7) and weeks (last 3) of partners who worked.
async function settleDue() {
  const policy = await getPolicy();
  const now = new Date();
  const delay = policy.settleDelayHours * 3600000;
  const since = t.addDays(t.startOfWeek(now), -21);
  const [delivered, online] = await Promise.all([
    Order.distinct('delivery', { orderStatus: 'delivered', deliveredAt: { $gte: since } }),
    RiderSession.distinct('rider', { $or: [{ endedAt: null }, { endedAt: { $gte: since } }] }),
  ]);
  const riders = [...new Set([...delivered, ...online].filter(Boolean).map(String))];
  const due = [];
  for (let i = 1; i <= 7; i += 1) {
    const day = t.addDays(t.startOfDay(now), -i);
    if (t.addDays(day, 1).getTime() + delay <= now.getTime()) due.push(['day', t.dateKey(day)]);
  }
  for (let w = 1; w <= 3; w += 1) {
    const week = t.addDays(t.startOfWeek(now), -7 * w);
    if (t.addDays(week, 7).getTime() + delay <= now.getTime()) due.push(['week', t.dateKey(week)]);
  }
  let settled = 0;
  for (const riderId of riders) {
    const done = await RiderPayPeriod.find({ rider: riderId, key: { $in: due.map(([, k]) => k) }, payoutStatus: { $nin: ['pending', 'settling'] }, $or: [{ payoutStatus: { $ne: 'withheld' } }, { figures: { $ne: null } }] })
      .select('kind key').lean();
    const skip = new Set(done.map((d) => `${d.kind}:${d.key}`));
    for (const [kind, key] of due) {
      if (skip.has(`${kind}:${key}`)) continue;
      const { from, to } = periodRange(kind, key);
      const worked = await Order.exists({ delivery: riderId, orderStatus: 'delivered', deliveredAt: { $gte: from, $lt: to } })
        || (kind === 'day' && policy.guarantee.enabled && await RiderSession.exists({ rider: riderId, startedAt: { $lt: to }, $or: [{ endedAt: null }, { endedAt: { $gt: from } }] }));
      if (!worked) continue;
      if (await settlePeriod(riderId, kind, key)) settled += 1;
    }
  }
  return settled;
}

// ---- Views -----------------------------------------------------------------------------------

// The rate card as the app shows it.
function rateCard(policy) {
  let from = 0;
  const km = policy.kmSlabs.map((s) => { const row = { fromKm: from, toKm: s.upToKm, label: `${from}–${s.upToKm} km`, amount: s.amount }; from = s.upToKm; return row; });
  const last = policy.kmSlabs[policy.kmSlabs.length - 1];
  km.push({ fromKm: last.upToKm, toKm: null, label: `${last.upToKm} km+`, amount: last.amount, perKmBeyond: policy.perKmBeyond });
  return {
    km,
    peak: policy.peak,
    rain: policy.rain,
    heavyLoad: policy.heavyLoad,
    waiting: policy.waiting.perMinute > 0 ? policy.waiting : null,
    cancellation: policy.cancellation.arrivedAtPickup > 0 || policy.cancellation.pickedUp > 0 ? policy.cancellation : null,
    daily: policy.daily,
    weekly: policy.weekly,
    guarantee: policy.guarantee.enabled ? policy.guarantee : null,
    eligibility: policy.eligibility,
  };
}

function periodView(doc, live) {
  const f = doc?.figures || live;
  return {
    ...f,
    payoutStatus: doc?.payoutStatus || 'pending',
    // Until settled, incentives are an estimate from progress so far.
    estimate: !doc?.settledAt,
    settledAt: doc?.settledAt || null,
    withheld: doc?.payoutStatus === 'withheld' ? { reason: doc.withheld?.reason || null, at: doc.withheld?.at || null } : null,
  };
}

// GET /delivery/earnings/incentives?date= — the day's slab progress and tier, that week's
// progress, the minimum guarantee and the rate card.
async function incentivesForRider(riderId, dateKey) {
  const policy = await getPolicy(riderId);
  const key = dateKey && t.parseDateKey(dateKey) ? dateKey : t.dateKey(new Date());
  const weekKey = t.dateKey(t.startOfWeek(t.parseDateKey(key)));
  const [dayDoc, weekDoc] = await Promise.all([
    RiderPayPeriod.findOne({ rider: riderId, kind: 'day', key }).lean(),
    RiderPayPeriod.findOne({ rider: riderId, kind: 'week', key: weekKey }).lean(),
  ]);
  const [day, week] = await Promise.all([
    dayDoc?.figures ? null : dayFigures(riderId, key, policy),
    weekDoc?.figures ? null : weekFigures(riderId, weekKey, policy),
  ]);
  return { day: periodView(dayDoc, day), week: periodView(weekDoc, week), rateCard: rateCard(policy) };
}

// Admin: a partner's settled / withheld periods, newest first, plus the live day and week.
async function periodsForRider(riderId, { kind, limit = 30 } = {}) {
  const where = { rider: riderId };
  if (kind) where.kind = kind;
  const today = t.dateKey(new Date());
  const thisWeek = t.dateKey(t.startOfWeek(new Date()));
  const policy = await getPolicy(riderId);
  const [rows, day, week] = await Promise.all([
    RiderPayPeriod.find(where).sort({ key: -1, kind: 1 }).limit(Math.min(Number(limit) || 30, 100)).lean(),
    kind === 'week' ? null : dayFigures(riderId, today, policy),
    kind === 'day' ? null : weekFigures(riderId, thisWeek, policy),
  ]);
  const has = (k, key) => rows.find((r) => r.kind === k && r.key === key);
  return {
    live: {
      day: day ? periodView(has('day', today), day) : null,
      week: week ? periodView(has('week', thisWeek), week) : null,
    },
    periods: rows.map((r) => ({ id: r._id, kind: r.kind, key: r.key, label: r.figures?.label || periodRange(r.kind, r.key).label, deliveries: r.figures?.deliveries ?? null, lines: r.lines, total: r.total, payoutStatus: r.payoutStatus, eligibility: r.eligibility, withheld: r.withheld, settledAt: r.settledAt, audit: r.audit })),
  };
}

// Admin: withheld periods across partners, for review.
async function listPeriods({ status, kind, riderId, limit = 50 } = {}) {
  const where = {};
  if (status) where.payoutStatus = status;
  if (kind) where.kind = kind;
  if (riderId) where.rider = riderId;
  const rows = await RiderPayPeriod.find(where).sort({ updatedAt: -1 }).limit(Math.min(Number(limit) || 50, 200)).populate('rider', 'name phone').lean();
  return rows.map((r) => ({ id: r._id, rider: r.rider, kind: r.kind, key: r.key, label: periodRange(r.kind, r.key).label, total: r.total, payoutStatus: r.payoutStatus, eligibility: r.eligibility, withheld: r.withheld, settledAt: r.settledAt }));
}

module.exports = {
  DEFAULT_POLICY,
  RAIN_LEVELS,
  SURGE_LEVELS,
  FINAL,
  globalPolicy,
  getPolicy,
  validatePolicyPatch,
  savePolicy,
  setRiderOverride,
  kmBase,
  activeConditions,
  quote,
  quoteOrder,
  orderWeightKg,
  computeTripPay,
  attachToTrip,
  detachFromTrip,
  startTrip,
  completeTripIfDone,
  onOrderStatus,
  listConditions,
  setConditions,
  dayFigures,
  weekFigures,
  settlePeriod,
  withholdPeriod,
  releasePeriod,
  settleDue,
  rateCard,
  incentivesForRider,
  periodsForRider,
  listPeriods,
};
