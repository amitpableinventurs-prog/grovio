const mongoose = require('mongoose');
const { Order, WalletTransaction, GigBooking, DeliveryTrip } = require('../models');
const { distanceKm } = require('../utils/geo');
const t = require('../utils/localTime');
const sessions = require('./riderSession.service');

// Delivery partner earnings and trips (Earnings, Trip History and "Today's progress" screens).
// Earnings are the partner's wallet credits, by category (models/walletTransaction.model.js):
//   order_earning — KM pay per delivered order, with its trip (services/riderPay.service.js)
//   incentive     — peak / rain / heavy-load bonuses, daily / weekly slabs, offer payouts
//   other_earning — waiting / cancellation pay, guarantee top-ups, admin adjustments, referral
//                   bonuses, … (POST /admin/delivery-partners/:id/earnings)

const ROAD_FACTOR = 1.3; // same as services/tracking.service.js
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// Credits made before categories existed were all order earnings.
const CATEGORY_EXPR = {
  $ifNull: ['$category', { $cond: [{ $eq: ['$reason', 'Delivery earning'] }, 'order_earning', null] }],
};

// What the partner is paid for one order (see completeJob).
// What the partner earned for one order: set when its trip is paid (services/riderPay.service.js).
// An order on a trip that isn't paid yet counts 0; an order from before trips pays its delivery charge.
function orderEarning(order) {
  if (order.riderPay) return round2(order.riderPay.total);
  if (order.trip) return 0;
  return order.orderStatus === 'delivered' ? round2(order.deliveryPartnerEarning ?? order.deliveryFee) : 0;
}

// Hub -> drop road distance estimate for an order with store/address populated.
function tripKm(order) {
  if (order.tripDistanceKm !== null && order.tripDistanceKm !== undefined) return order.tripDistanceKm;
  const d = distanceKm(order.store?.lat, order.store?.lng, order.address?.lat, order.address?.lng);
  return Number.isFinite(d) ? round2(d * ROAD_FACTOR) : null;
}

// Earning credits and deductions in [from, to), with their resolved category and a signed
// amount (deductions negative). Cash collected / deposits / payouts aren't earnings.
function creditsBetween(riderId, from, to) {
  return WalletTransaction.aggregate([
    { $match: { user: oid(riderId), createdAt: { $gte: from, $lt: to } } },
    { $addFields: { cat: CATEGORY_EXPR } },
    {
      $match: {
        $or: [
          { type: 'credit', cat: { $in: ['order_earning', 'incentive', 'other_earning'] } },
          { type: 'debit', cat: 'deduction' },
        ],
      },
    },
    { $addFields: { signed: { $cond: [{ $eq: ['$type', 'debit'] }, { $multiply: ['$amount', -1] }, '$amount'] } } },
    { $sort: { createdAt: 1 } },
  ]);
}

// Delivered orders + their earnings in [from, to) (gig and offer progress).
async function deliveredStats(riderId, from, to) {
  const orders = await Order.find({ delivery: riderId, orderStatus: 'delivered', deliveredAt: { $gte: from, $lt: to } })
    .select('orderStatus deliveryPartnerEarning deliveryFee trip riderPay');
  return { trips: orders.length, earnings: round2(orders.reduce((s, o) => s + orderEarning(o), 0)) };
}

// ---- Periods --------------------------------------------------------------------------------

// period=day|week|month, date=YYYY-MM-DD (any day inside it; default today).
function periodRange(period, date) {
  const now = new Date();
  const anchor = t.dayFromQuery(date);
  let from;
  let to;
  let label;
  if (period === 'week') {
    from = t.startOfWeek(anchor);
    to = t.addDays(from, 7);
    label = `${t.dayLabel(from)} - ${t.dayLabel(t.addDays(to, -1))}`;
  } else if (period === 'month') {
    from = t.startOfMonth(anchor);
    to = t.addMonths(from, 1);
    label = t.monthLabel(from);
  } else {
    period = 'day';
    from = t.startOfDay(anchor);
    to = t.addDays(from, 1);
    label = t.dateKey(from) === t.dateKey(now) ? `Today: ${t.dayOfMonth(from)} ${t.monthLabel(from)}` : `${t.dayOfMonth(from)} ${t.monthLabel(from)}`;
  }
  const prevFrom = period === 'month' ? t.addMonths(from, -1) : period === 'week' ? t.addDays(from, -7) : t.addDays(from, -1);
  return {
    period,
    from,
    to,
    label,
    prevDate: t.dateKey(prevFrom),
    nextDate: to <= now ? t.dateKey(to) : null,
  };
}

// Chart bars: none for a day, each day for a week, Mon–Sun weeks (clipped to the month) for a month.
function chartBuckets(range) {
  if (range.period === 'week') {
    return Array.from({ length: 7 }, (_, i) => {
      const from = t.addDays(range.from, i);
      return { label: String(t.dayOfMonth(from)), date: t.dateKey(from), from, to: t.addDays(from, 1) };
    });
  }
  if (range.period === 'month') {
    const buckets = [];
    let from = range.from;
    while (from < range.to) {
      let to = t.addDays(t.startOfWeek(from), 7);
      if (to > range.to) to = range.to;
      buckets.push({ label: `${t.dayOfMonth(from)}-${t.dayOfMonth(t.addDays(to, -1))}`, date: t.dateKey(from), from, to });
      from = to;
    }
    return buckets;
  }
  return [];
}

// ---- Earnings screen ------------------------------------------------------------------------

// GET /delivery/earnings/summary?period=day|week|month&date=
async function earningsSummary(riderId, query = {}) {
  const range = periodRange(query.period, query.date);
  const [credits, orders, loginMs] = await Promise.all([
    creditsBetween(riderId, range.from, range.to),
    Order.countDocuments({ delivery: riderId, orderStatus: 'delivered', deliveredAt: { $gte: range.from, $lt: range.to } }),
    sessions.onlineMs(riderId, range.from, range.to),
  ]);
  const loginMinutes = Math.floor(loginMs / 60000);

  const byCat = { order_earning: [], incentive: [], other_earning: [], deduction: [] };
  credits.forEach((c) => byCat[c.cat].push(c));
  const sum = (rows) => round2(rows.reduce((s, r) => s + r.amount, 0));
  // Net of deductions (penalties), like the app's total.
  const total = round2(credits.reduce((s, c) => s + c.signed, 0));

  // Order earnings: one row per order for a day, per day otherwise.
  let orderItems;
  if (range.period === 'day') {
    const refs = await Order.find({ _id: { $in: byCat.order_earning.map((c) => c.refOrderId).filter(Boolean) } }).select('orderNumber').lean();
    const numbers = new Map(refs.map((o) => [String(o._id), o.orderNumber]));
    orderItems = byCat.order_earning.map((c) => ({ orderId: c.refOrderId, orderNumber: numbers.get(String(c.refOrderId)) || null, amount: round2(c.amount), at: c.createdAt }));
  } else {
    const perDay = new Map();
    byCat.order_earning.forEach((c) => {
      const key = t.dateKey(c.createdAt);
      const row = perDay.get(key) || { date: key, label: `${t.dayLabel(c.createdAt)}, ${t.weekdayLabel(c.createdAt)}`, orders: 0, amount: 0 };
      row.orders += 1;
      row.amount = round2(row.amount + c.amount);
      perDay.set(key, row);
    });
    orderItems = [...perDay.values()];
  }

  const chart = chartBuckets(range).map((b) => ({
    label: b.label,
    date: b.date,
    amount: round2(credits.filter((c) => c.createdAt >= b.from && c.createdAt < b.to).reduce((s, c) => s + c.signed, 0)),
  }));

  return {
    period: range.period,
    from: range.from,
    to: range.to,
    label: range.label,
    chartTitle: range.period === 'week' ? `${range.label} ${t.year(range.from)}` : range.period === 'month' ? `${range.label} ${t.year(range.from)}` : null,
    prevDate: range.prevDate,
    nextDate: range.nextDate,
    total,
    orders,
    loginMinutes,
    loginHoursLabel: sessions.hhmm(loginMinutes),
    // Exact login time, not whole minutes: ₹96.76 over 59m08s is ₹98.18/hr.
    earningsPerHour: loginMs >= 60000 ? round2(total / (loginMs / 3600000)) : 0,
    chart,
    breakdown: {
      orderEarning: { total: sum(byCat.order_earning), items: orderItems },
      incentive: {
        total: sum(byCat.incentive),
        items: byCat.incentive.map((c) => ({ offerId: c.refOfferId, title: c.reason.replace(/^Incentive:\s*/, ''), amount: round2(c.amount), at: c.createdAt })),
      },
      other: { total: sum(byCat.other_earning), items: byCat.other_earning.map((c) => ({ reason: c.reason, orderId: c.refOrderId, amount: round2(c.amount), at: c.createdAt })) },
      // Shown as a positive amount; already taken off `total`.
      deductions: { total: sum(byCat.deduction), items: byCat.deduction.map((c) => ({ title: c.title || c.reason, description: c.description, orderId: c.refOrderId, amount: round2(c.amount), at: c.createdAt })) },
    },
  };
}

// ---- Trip history ---------------------------------------------------------------------------

const TRIP_TYPES = { delivered: ['delivered'], cancelled: ['cancelled'], failed: ['delivery_failed'], returned: ['returned'] };
const tripTime = (o) => o.deliveredAt || o.updatedAt;
const cash = (o) => (o.paymentMethod === 'COD' && o.codCollectionMethod === 'cash' ? round2(o.grandTotal) : 0);
const statusAt = (o, status) => (o.statusLogs || []).filter((l) => l.status === status).map((l) => l.createdAt).pop() || null;

// Who cancelled a cancelled order, for the "CANCELLATION" tag.
function cancellationOf(o) {
  if (o.orderStatus !== 'cancelled') return null;
  const log = (o.statusLogs || []).filter((l) => l.status === 'cancelled').pop();
  const by = !log?.changedBy ? 'system' : String(log.changedBy) === String(o.customer?._id || o.customer) ? 'customer' : 'customer_care';
  const labels = { customer: 'Cancelled by customer', customer_care: 'Cancelled by customer care', system: 'Cancelled' };
  return { tag: 'CANCELLATION', cancelledBy: by, label: labels[by], reason: o.cancelReason || log?.note || null };
}

const ORDER_FIELDS = 'orderNumber orderStatus customer delivery deliveredAt updatedAt deliveryAcceptedAt pickerHandoverAt deliveryPartnerEarning deliveryFee paymentMethod codCollectionMethod grandTotal tripDistanceKm statusLogs store address trip riderPay riderPayQuote cancelReason failureReason deliveryRejections';

// A trip card: one per trip (a multi-order trip is one card), ₹0 when nothing was delivered.
function tripCard(orders, trip) {
  const at = orders.reduce((m, o) => (tripTime(o) > m ? tripTime(o) : m), tripTime(orders[0]));
  const allCancelled = orders.every((o) => o.orderStatus === 'cancelled');
  const status = orders.some((o) => o.orderStatus === 'delivered') ? 'delivered' : allCancelled ? 'cancelled' : orders[0].orderStatus === 'returned' ? 'returned' : 'delivery_failed';
  const isMultiOrder = (trip?.orders?.length || orders.length) > 1;
  const paid = trip?.status === 'completed';
  return {
    id: trip?._id || orders[0]._id,
    tripId: trip?._id || null,
    orderIds: orders.map((o) => o._id),
    orderNumbers: orders.map((o) => o.orderNumber),
    orderId: orders[0]._id,
    orderNumber: orders[0].orderNumber,
    storeName: orders[0].store?.name || null,
    status,
    isMultiOrder,
    tag: isMultiOrder ? 'MULTI ORDER' : allCancelled ? 'CANCELLATION' : null,
    cancellation: allCancelled ? cancellationOf(orders[0]) : null,
    at,
    timeLabel: t.timeLabel(at),
    earning: paid ? round2(trip.pay.total) : round2(orders.reduce((s, o) => s + orderEarning(o), 0)),
    // Multi-order trip still out: paid when all its orders are done.
    payPending: !!trip && !paid,
    cashCollected: round2(orders.reduce((s, o) => s + cash(o), 0)),
    distanceKm: round2(orders.reduce((s, o) => s + (tripKm(o) || 0), 0)),
  };
}

// Orders I handed back after accepting (my cancellations): ₹0 trips.
function riderCancelCard(o, rejection) {
  return {
    id: o._id,
    tripId: null,
    orderIds: [o._id],
    orderNumbers: [o.orderNumber],
    orderId: o._id,
    orderNumber: o.orderNumber,
    storeName: o.store?.name || null,
    status: 'cancelled',
    isMultiOrder: false,
    tag: 'CANCELLATION',
    cancellation: { tag: 'CANCELLATION', cancelledBy: 'you', label: 'Cancelled by you', reason: rejection.reason || null },
    at: rejection.at,
    timeLabel: t.timeLabel(rejection.at),
    earning: 0,
    payPending: false,
    cashCollected: 0,
    distanceKm: 0,
  };
}

// GET /delivery/trips?period=day|week|month&date=&type=all|delivered|cancelled|failed|returned
async function tripHistory(riderId, query = {}) {
  const range = periodRange(query.period, query.date);
  const type = TRIP_TYPES[query.type] ? query.type : 'all';
  const statuses = TRIP_TYPES[type] || ['delivered', 'delivery_failed', 'returned', 'cancelled'];
  const inRange = { $gte: range.from, $lt: range.to };

  const [orders, handedBack] = await Promise.all([
    Order.find({
      delivery: riderId,
      orderStatus: { $in: statuses },
      $or: [{ deliveredAt: inRange }, { deliveredAt: null, updatedAt: inRange }],
    }).select(ORDER_FIELDS).populate('store', 'name lat lng').populate('address', 'lat lng').lean(),
    ['all', 'cancelled'].includes(type)
      ? Order.find({ deliveryRejections: { $elemMatch: { rider: oid(riderId), kind: 'cancellation', at: inRange } } }).select('orderNumber store deliveryRejections').populate('store', 'name').lean()
      : [],
  ]);

  const tripIds = [...new Set(orders.map((o) => o.trip).filter(Boolean).map(String))];
  const trips = new Map((tripIds.length ? await DeliveryTrip.find({ _id: { $in: tripIds } }).lean() : []).map((x) => [String(x._id), x]));
  const groups = new Map();
  orders.forEach((o) => {
    const key = o.trip ? `t${o.trip}` : `o${o._id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  const cards = [...groups.values()].map((os) => tripCard(os, os[0].trip ? trips.get(String(os[0].trip)) : null));
  handedBack.forEach((o) => o.deliveryRejections
    .filter((r) => String(r.rider) === String(riderId) && r.kind === 'cancellation' && r.at >= range.from && r.at < range.to)
    .forEach((r) => cards.push(riderCancelCard(o, r))));
  cards.sort((a, b) => b.at - a.at);

  const days = new Map();
  cards.forEach((c) => {
    const key = t.dateKey(c.at);
    if (!days.has(key)) days.set(key, { date: key, label: `${t.dayLabel(c.at).padStart(6, '0')}, ${t.year(c.at)}`, trips: [] });
    days.get(key).trips.push(c);
  });

  return {
    period: range.period,
    from: range.from,
    to: range.to,
    label: range.label,
    prevDate: range.prevDate,
    nextDate: range.nextDate,
    type,
    types: [{ key: 'all', label: 'ALL TRIPS' }, { key: 'delivered', label: 'DELIVERED' }, { key: 'cancelled', label: 'CANCELLED' }, { key: 'failed', label: 'FAILED' }, { key: 'returned', label: 'RETURNED' }],
    totals: {
      trips: cards.length,
      orders: cards.reduce((s, c) => s + c.orderIds.length, 0),
      earnings: round2(cards.reduce((s, c) => s + c.earning, 0)),
      cashCollected: round2(cards.reduce((s, c) => s + c.cashCollected, 0)),
      distanceKm: round2(cards.reduce((s, c) => s + c.distanceKm, 0)),
    },
    days: [...days.values()],
  };
}

function orderSection(o, index, count, riderCancel = null) {
  const cancellation = riderCancel || cancellationOf(o);
  const km = o.orderStatus === 'delivered' ? tripKm(o) : null;
  const assignedAt = statusAt(o, 'assigned') || o.deliveryAcceptedAt;
  const pickedAt = statusAt(o, 'picked_up') || o.pickerHandoverAt;
  return {
    orderId: o._id,
    orderNumber: o.orderNumber,
    label: count > 1 ? `Order ${index + 1}: ${o.orderNumber}` : `Order: ${o.orderNumber}`,
    status: riderCancel ? 'cancelled' : o.orderStatus,
    cancellation,
    earning: riderCancel ? 0 : orderEarning(o),
    cashCollected: riderCancel ? 0 : cash(o),
    pickup: { name: o.store?.name || null, address: o.store?.address || null, assignedAt },
    drop: {
      name: o.customer?.name || null,
      line1: o.address?.line1 || null,
      landmark: o.address?.landmark || null,
      city: o.address?.city || null,
      pincode: o.address?.pincode || null,
      pickedAt,
      deliveredAt: o.orderStatus === 'delivered' && !riderCancel ? o.deliveredAt : null,
    },
    distanceKm: km,
    distanceLabel: km !== null ? `${km.toFixed(1)} km` : null,
    failureReason: o.failureReason || null,
    // This order's pay: mapped km, KM slab and pay, peak / rain / heavy-load bonuses, waiting and
    // cancellation pay (services/riderPay.service.js); the quote shown before accepting until then.
    pay: riderCancel ? null : o.riderPay || null,
    payQuote: riderCancel || o.riderPay ? null : o.riderPayQuote || null,
  };
}

// GET /delivery/trips/:id — Trip details, by trip id or any of its order ids. A multi-order trip
// lists every order ("Order 1: …", "Order 2: …"); a cancelled one shows ₹0 and why.
async function tripDetail(riderId, id) {
  const populate = (q) => q.select(ORDER_FIELDS)
    .populate('store', 'name address lat lng')
    .populate('address', 'line1 landmark city pincode lat lng')
    .populate('customer', 'name')
    .lean();

  let trip = await DeliveryTrip.findOne({ _id: id, rider: riderId }).lean().catch(() => null);
  let orders;
  let riderCancel = null;
  if (trip) {
    orders = await populate(Order.find({ _id: { $in: trip.orders } }));
  } else {
    const order = await populate(Order.findOne({ _id: id, $or: [{ delivery: riderId }, { deliveryRejections: { $elemMatch: { rider: oid(riderId), kind: 'cancellation' } } }] }));
    if (!order) return null;
    const myRejection = (order.deliveryRejections || []).filter((x) => String(x.rider) === String(riderId) && x.kind === 'cancellation').pop();
    if (String(order.delivery || '') !== String(riderId) && myRejection) {
      // I handed it back after accepting it.
      riderCancel = { tag: 'CANCELLATION', cancelledBy: 'you', label: 'Cancelled by you', reason: myRejection.reason || null };
      orders = [order];
    } else if (order.trip) {
      trip = await DeliveryTrip.findById(order.trip).lean();
      orders = trip ? await populate(Order.find({ _id: { $in: trip.orders } })) : [order];
    } else {
      orders = [order];
    }
  }
  if (trip) {
    const rank = new Map(trip.orders.map((x, i) => [String(x), i]));
    orders.sort((a, b) => rank.get(String(a._id)) - rank.get(String(b._id)));
  }

  // Pay lines: the trip's pay (or an older order's pay), plus anything added for these orders
  // later (e.g. "Long Distance Return Pay" after a support ticket) and deductions tied to them.
  const payLines = [];
  if (riderCancel) {
    // nothing earned
  } else if (trip?.status === 'completed') {
    trip.pay.lines.forEach((l) => payLines.push({ label: l.label, amount: l.amount }));
  } else if (!trip) {
    const earned = orders.reduce((s, o) => s + orderEarning(o), 0);
    if (earned) payLines.push({ label: 'Order pay', amount: round2(earned) });
  }
  const extras = riderCancel ? [] : await WalletTransaction.find({ user: riderId, refOrderId: { $in: orders.map((o) => o._id) }, category: { $in: ['other_earning', 'deduction'] } }).sort({ createdAt: 1 }).lean();
  extras.forEach((x) => payLines.push({ label: x.title || x.reason, description: x.description || null, amount: round2(x.type === 'debit' ? -x.amount : x.amount) }));

  const sections = orders.map((o, i) => orderSection(o, i, orders.length, riderCancel));
  const isMultiOrder = orders.length > 1;
  const allCancelled = sections.every((s) => s.status === 'cancelled');
  const first = sections[0];
  return {
    id: trip?._id || orders[0]._id,
    tripId: trip?._id || null,
    isMultiOrder,
    tag: isMultiOrder ? 'MULTI ORDER' : allCancelled ? 'CANCELLATION' : null,
    status: allCancelled ? 'cancelled' : sections.some((s) => s.status === 'delivered') ? 'delivered' : first.status,
    totalEarnings: round2(payLines.reduce((s, l) => s + l.amount, 0)),
    payLines,
    payPending: !!trip && trip.status !== 'completed',
    cashCollected: round2(sections.reduce((s, x) => s + x.cashCollected, 0)),
    orders: sections,
    // The first (or only) order, flattened — handy for a single-order trip.
    orderId: first.orderId,
    orderNumber: first.orderNumber,
    storeName: first.pickup.name,
    customerName: first.drop.name,
    cancellation: first.cancellation,
    pickup: first.pickup,
    drop: first.drop,
    assignedAt: first.pickup.assignedAt,
    pickedAt: first.drop.pickedAt,
    deliveredAt: first.drop.deliveredAt,
    distanceKm: first.distanceKm,
    distanceLabel: first.distanceLabel,
    // "Need help on this trip?" -> POST /common/support { category: 'past_order', orderId }
    help: { category: 'past_order', orderId: first.orderId },
  };
}

// "Today's progress" card: earnings, trip km, session hours, gigs.
async function todayProgress(riderId) {
  const from = t.startOfDay();
  const to = t.addDays(from, 1);
  const [credits, orders, loginMinutes, gigs] = await Promise.all([
    creditsBetween(riderId, from, to),
    Order.find({ delivery: riderId, orderStatus: 'delivered', deliveredAt: { $gte: from, $lt: to } })
      .select('tripDistanceKm store address').populate('store', 'lat lng').populate('address', 'lat lng').lean(),
    sessions.onlineMinutes(riderId, from, to),
    GigBooking.countDocuments({ rider: riderId, status: { $ne: 'cancelled' }, startAt: { $gte: from, $lt: to } }),
  ]);
  return {
    earnings: round2(credits.reduce((s, c) => s + c.signed, 0)),
    trips: orders.length,
    tripKm: round2(orders.reduce((s, o) => s + (tripKm(o) || 0), 0)),
    sessionMinutes: loginMinutes,
    sessionHoursLabel: sessions.hhmm(loginMinutes),
    gigs,
  };
}

module.exports = { ROAD_FACTOR, round2, tripKm, orderEarning, deliveredStats, creditsBetween, periodRange, earningsSummary, tripHistory, tripDetail, todayProgress };
