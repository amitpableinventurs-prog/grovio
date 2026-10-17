const mongoose = require('mongoose');
const { Order, User, Store, Product, PickerProfile, DeliveryProfile } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { hasFullAccess } = require('../../utils/storeScope');
const { PERMISSIONS } = require('../../utils/permissions');

// Business days/hours are counted in this timezone (orders at 11:30 PM IST belong to that day).
const TZ = process.env.DASHBOARD_TZ || 'Asia/Kolkata';
const RANGES = { today: 1, '7d': 7, '30d': 30, '90d': 90 };
const NOT_COUNTED = ['rejected', 'cancelled']; // excluded from GMV / AOV
const LOW_STOCK_AT = 5;

// Live pipeline stages (right now, not range-bound), in order.
const PIPELINE = [
  { key: 'new', label: 'Waiting to accept', statuses: ['placed'] },
  { key: 'picking', label: 'Being picked', statuses: ['accepted', 'picking', 'partially_picked'] },
  { key: 'packed', label: 'Packed, needs rider', statuses: ['packed'] },
  { key: 'assigned', label: 'Rider going to hub', statuses: ['assigned'] },
  { key: 'onTheWay', label: 'Out for delivery', statuses: ['picked_up', 'out_for_delivery'] },
];

// Wall-clock parts of a Date in TZ.
function tzParts(date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
    .formatToParts(date)
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const hour = Number(p.hour) % 24;
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    hour,
    // The same wall-clock time read as if it were UTC — its difference from `date` is the offset.
    asUtcMs: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second)),
  };
}

// Start of today in TZ as a real instant (works for any offset, including +05:30).
function startOfTodayInTz(now = new Date()) {
  const parts = tzParts(now);
  const offsetMs = parts.asUtcMs - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.parse(`${parts.day}T00:00:00Z`) - offsetMs);
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const pct = (part, whole) => (whole ? round2((part / whole) * 100) : 0);

// Orders a restricted store manager may see: their store is the hub or supplies items.
function orderScope(user) {
  if (hasFullAccess(user, PERMISSIONS.MANAGE_ORDERS) || !user.assignedStore) return {};
  const id = new mongoose.Types.ObjectId(String(user.assignedStore));
  return { $or: [{ store: id }, { 'items.pickupStore': id }] };
}

async function periodTotals(match) {
  const [row] = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        counted: { $sum: { $cond: [{ $in: ['$orderStatus', NOT_COUNTED] }, 0, 1] } },
        gmv: { $sum: { $cond: [{ $in: ['$orderStatus', NOT_COUNTED] }, 0, '$grandTotal'] } },
        delivered: { $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $in: ['$orderStatus', NOT_COUNTED] }, 1, 0] } },
      },
    },
  ]);
  const t = row || { orders: 0, counted: 0, gmv: 0, delivered: 0, cancelled: 0 };
  return {
    orders: t.orders,
    gmv: round2(t.gmv),
    averageOrderValue: t.counted ? round2(t.gmv / t.counted) : 0,
    delivered: t.delivered,
    cancelled: t.cancelled,
    cancellationRate: pct(t.cancelled, t.orders),
  };
}

// GET /admin/dashboard?range=today|7d|30d|90d (default 30d)
// Headline numbers for the range + the same for the previous period up to the same point (deltas),
// a revenue/orders trend (hourly for today, daily otherwise), orders by hour of day, payment mix,
// top products and stores, the live order pipeline, and operations counts. A store manager sees
// only orders involving their store. The original all-time fields are kept for older clients.
const getStats = catchAsync(async (req, res) => {
  const range = RANGES[req.query.range] ? req.query.range : '30d';
  const days = RANGES[range];
  const scope = orderScope(req.user);
  const scopedStoreId = scope.$or ? req.user.assignedStore : null;

  const todayStart = startOfTodayInTz();
  const to = new Date();
  const from = new Date(todayStart.getTime() - (days - 1) * 86400000);
  // The previous period covers the same elapsed time — "today so far" is compared with yesterday
  // up to the same clock time, not with all of yesterday.
  const prevFrom = new Date(from.getTime() - days * 86400000);
  const prevTo = new Date(to.getTime() - days * 86400000);
  const inRange = { ...scope, placedAt: { $gte: from, $lte: to } };
  const inPrev = { ...scope, placedAt: { $gte: prevFrom, $lte: prevTo } };
  const counted = { ...inRange, orderStatus: { $nin: NOT_COUNTED } };

  const hourly = range === 'today';
  const bucketFormat = hourly ? '%Y-%m-%dT%H' : '%Y-%m-%d';

  const [
    current, previous, trendRows, hourRows, paymentRows, productRows, storeRows, pipelineRows,
    newCustomers, prevNewCustomers,
    activeStores, activePickers, activeDeliveryPartners, totalCustomers, totalProducts, lowStock,
    allTime,
  ] = await Promise.all([
    periodTotals(inRange),
    periodTotals(inPrev),
    Order.aggregate([
      { $match: inRange },
      {
        $group: {
          _id: { $dateToString: { format: bucketFormat, date: '$placedAt', timezone: TZ } },
          orders: { $sum: 1 },
          gmv: { $sum: { $cond: [{ $in: ['$orderStatus', NOT_COUNTED] }, 0, '$grandTotal'] } },
        },
      },
    ]),
    Order.aggregate([
      { $match: inRange },
      { $group: { _id: { $hour: { date: '$placedAt', timezone: TZ } }, orders: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: counted },
      { $group: { _id: '$paymentMethod', orders: { $sum: 1 }, amount: { $sum: '$grandTotal' } } },
    ]),
    Order.aggregate([
      { $match: counted },
      { $unwind: '$items' },
      ...(scopedStoreId ? [{ $match: { 'items.pickupStore': new mongoose.Types.ObjectId(String(scopedStoreId)) } }] : []),
      { $group: { _id: '$items.product', name: { $last: '$items.nameSnapshot' }, qty: { $sum: '$items.qty' }, revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
    Order.aggregate([
      { $match: counted },
      { $group: { _id: '$store', orders: { $sum: 1 }, gmv: { $sum: '$grandTotal' } } },
      { $sort: { gmv: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'stores', localField: '_id', foreignField: '_id', as: 'store' } },
    ]),
    Order.aggregate([
      { $match: { ...scope, orderStatus: { $in: PIPELINE.flatMap((p) => p.statuses) } } },
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
    ]),
    User.countDocuments({ role: 'customer', createdAt: { $gte: from, $lte: to } }),
    User.countDocuments({ role: 'customer', createdAt: { $gte: prevFrom, $lte: prevTo } }),
    scopedStoreId ? Store.countDocuments({ _id: scopedStoreId, status: 'active' }) : Store.countDocuments({ status: 'active' }),
    PickerProfile.countDocuments({ status: 'approved', isAvailable: true, ...(scopedStoreId ? { store: scopedStoreId } : {}) }),
    DeliveryProfile.countDocuments({ status: 'approved', isAvailable: true }),
    User.countDocuments({ role: 'customer' }),
    Product.countDocuments(scopedStoreId ? { store: scopedStoreId } : {}),
    Product.countDocuments({ isAvailable: true, stockQty: { $lte: LOW_STOCK_AT }, ...(scopedStoreId ? { store: scopedStoreId } : {}) }),
    periodTotals(scope),
  ]);

  // Zero-filled trend buckets, oldest first.
  const byBucket = new Map(trendRows.map((r) => [r._id, r]));
  const trend = [];
  if (hourly) {
    const currentHour = tzParts(to).hour;
    const { day } = tzParts(to);
    for (let h = 0; h <= currentHour; h++) {
      const key = `${day}T${String(h).padStart(2, '0')}`;
      const row = byBucket.get(key);
      trend.push({ bucket: key, orders: row?.orders || 0, gmv: round2(row?.gmv) });
    }
  } else {
    for (let i = 0; i < days; i++) {
      const key = tzParts(new Date(from.getTime() + i * 86400000 + 12 * 3600000)).day;
      const row = byBucket.get(key);
      trend.push({ bucket: key, orders: row?.orders || 0, gmv: round2(row?.gmv) });
    }
  }

  const byHourMap = new Map(hourRows.map((r) => [r._id, r.orders]));
  const ordersByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: byHourMap.get(hour) || 0 }));

  const statusCount = new Map(pipelineRows.map((r) => [r._id, r.count]));
  const pipeline = PIPELINE.map((p) => ({ key: p.key, label: p.label, count: p.statuses.reduce((s, st) => s + (statusCount.get(st) || 0), 0) }));

  new ApiResponse(200, {
    range,
    from,
    to,
    timezone: TZ,
    granularity: hourly ? 'hour' : 'day',
    current: { ...current, newCustomers },
    previous: { ...previous, newCustomers: prevNewCustomers },
    trend,
    ordersByHour,
    paymentMix: paymentRows.map((r) => ({ method: r._id, orders: r.orders, amount: round2(r.amount) })).sort((a, b) => b.amount - a.amount),
    topProducts: productRows.map((r) => ({ productId: r._id, name: r.name, qty: r.qty, revenue: round2(r.revenue) })),
    topStores: storeRows.map((r) => ({ storeId: r._id, name: r.store[0]?.name || 'Unknown store', orders: r.orders, gmv: round2(r.gmv) })),
    pipeline,
    operations: { activeStores, activePickers, activeDeliveryPartners, totalCustomers, totalProducts, lowStock, lowStockAt: LOW_STOCK_AT },

    // All-time figures (original response shape).
    totalOrders: allTime.orders,
    totalCustomers,
    activeStores,
    activePickers,
    activeDeliveryPartners,
    totalProducts,
    deliveredOrders: allTime.delivered,
    cancelledOrders: allTime.cancelled,
    gmv: allTime.gmv,
    averageOrderValue: allTime.averageOrderValue,
  }).send(res);
});

module.exports = { getStats };
