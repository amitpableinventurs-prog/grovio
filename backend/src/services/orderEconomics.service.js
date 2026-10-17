const { Order, Product, Refund, Setting } = require('../models');
const t = require('../utils/localTime');
const { getSetting, invalidateSettingsCache } = require('./settings.service');

// Per-order contribution (GoGrovio policy §11):
//   Order contribution = gross margin − picker cost − delivery cost − packaging cost
//                        − payment gateway cost − refund/wastage − other variable costs
// Gross margin = (price − cost) × qty for the items actually delivered, plus the fees the
// customer paid (delivery, handling, packing, surcharge), minus discounts. Tax is a pass-through
// and left out. Product cost is Product.costPrice when set, else price × (1 − defaultMarginPct).
// Assumptions live in the `orderEconomics` setting (GET/PUT /admin/order-economics).

const DEFAULTS = {
  defaultMarginPct: 18, // product margin when a product has no costPrice
  packagingCostPerOrder: 4,
  gatewayPct: 2, // on prepaid online payments (Razorpay / PayU / PhonePe)
  otherCostPerOrder: 0,
  lowContributionBelow: 0, // flag orders earning less than this
};
const ONLINE = ['RAZORPAY', 'PAYU', 'PHONEPE'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function getAssumptions() {
  try {
    const raw = await getSetting('orderEconomics');
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return DEFAULTS;
  }
}

async function saveAssumptions(changes) {
  const next = { ...(await getAssumptions()) };
  for (const k of Object.keys(DEFAULTS)) if (changes[k] !== undefined && Number.isFinite(Number(changes[k]))) next[k] = Number(changes[k]);
  await Setting.findOneAndUpdate({ key: 'orderEconomics' }, { value: JSON.stringify(next) }, { upsert: true });
  invalidateSettingsCache();
  return next;
}

function orderContribution(o, costOf, refunds, a) {
  let productMargin = 0;
  let revenue = 0;
  for (const i of o.items || []) {
    if (i.isAvailable === false) continue;
    const qty = Number(i.pickedQty ?? i.qty) || 0;
    const cost = costOf(i);
    revenue += i.price * qty;
    productMargin += (i.price - cost) * qty;
  }
  const fees = (o.deliveryFee || 0) + (o.handlingCharge || 0) + (o.packingCharge || 0) + (o.surcharge || 0);
  const grossMargin = productMargin + fees - (o.discount || 0);
  const pickerCost = (o.pickTasks || []).reduce((s, x) => s + (x.pay?.total || 0), 0);
  const deliveryCost = o.riderPay ? o.riderPay.total : (o.orderStatus === 'delivered' ? (o.deliveryPartnerEarning ?? o.deliveryFee ?? 0) : 0);
  const packagingCost = a.packagingCostPerOrder;
  const gatewayCost = ONLINE.includes(o.paymentMethod) && ['paid', 'refunded'].includes(o.paymentStatus) ? (o.grandTotal * a.gatewayPct) / 100 : 0;
  const refundWastage = refunds.get(String(o._id)) || 0;
  const other = a.otherCostPerOrder;
  const contribution = grossMargin - pickerCost - deliveryCost - packagingCost - gatewayCost - refundWastage - other;
  return {
    orderId: o._id,
    orderNumber: o.orderNumber,
    status: o.orderStatus,
    date: o.deliveredAt || o.updatedAt,
    grandTotal: round2(o.grandTotal),
    itemRevenue: round2(revenue),
    grossMargin: round2(grossMargin),
    costs: {
      picker: round2(pickerCost),
      delivery: round2(deliveryCost),
      packaging: round2(packagingCost),
      gateway: round2(gatewayCost),
      refundWastage: round2(refundWastage),
      other: round2(other),
    },
    contribution: round2(contribution),
    marginPct: o.grandTotal ? round2((contribution / o.grandTotal) * 100) : null,
    lowContribution: contribution < a.lowContributionBelow,
  };
}

// GET /admin/reports/order-contribution?from=&to=&storeId=&lossOnly=
async function contributionReport(query = {}) {
  const a = await getAssumptions();
  const from = query.from ? t.dayFromQuery(query.from) : t.addDays(t.startOfDay(), -6);
  const to = query.to ? t.addDays(t.dayFromQuery(query.to), 1) : t.addDays(t.startOfDay(), 1);
  const where = {
    orderStatus: { $in: ['delivered', 'returned'] },
    $or: [{ deliveredAt: { $gte: from, $lt: to } }, { deliveredAt: null, updatedAt: { $gte: from, $lt: to } }],
  };
  if (query.storeId) where.store = query.storeId;
  const orders = await Order.find(where)
    .select('orderNumber orderStatus deliveredAt updatedAt items grandTotal deliveryFee handlingCharge packingCharge surcharge discount paymentMethod paymentStatus pickTasks riderPay deliveryPartnerEarning store')
    .lean();

  const productIds = [...new Set(orders.flatMap((o) => o.items.map((i) => String(i.product))))];
  const products = await Product.find({ _id: { $in: productIds } }).select('costPrice').lean();
  const costs = new Map(products.map((p) => [String(p._id), p.costPrice]));
  const costOf = (i) => {
    const c = costs.get(String(i.product));
    return c !== null && c !== undefined ? c : i.price * (1 - a.defaultMarginPct / 100);
  };
  const refundRows = await Refund.aggregate([
    { $match: { order: { $in: orders.map((o) => o._id) }, status: 'processed' } },
    { $group: { _id: '$order', amount: { $sum: '$amount' } } },
  ]);
  const refunds = new Map(refundRows.map((r) => [String(r._id), r.amount]));

  let rows = orders.map((o) => orderContribution(o, costOf, refunds, a)).sort((x, y) => x.contribution - y.contribution);
  const sum = (fn) => round2(rows.reduce((s, r) => s + fn(r), 0));
  const totals = {
    orders: rows.length,
    grandTotal: sum((r) => r.grandTotal),
    grossMargin: sum((r) => r.grossMargin),
    costs: {
      picker: sum((r) => r.costs.picker), delivery: sum((r) => r.costs.delivery), packaging: sum((r) => r.costs.packaging),
      gateway: sum((r) => r.costs.gateway), refundWastage: sum((r) => r.costs.refundWastage), other: sum((r) => r.costs.other),
    },
    contribution: sum((r) => r.contribution),
    lowContributionOrders: rows.filter((r) => r.lowContribution).length,
  };
  totals.avgContributionPerOrder = rows.length ? round2(totals.contribution / rows.length) : 0;
  if (String(query.lossOnly) === 'true') rows = rows.filter((r) => r.lowContribution);
  return { from, to, assumptions: a, totals, items: rows.slice(0, 500) };
}

module.exports = { DEFAULTS, getAssumptions, saveAssumptions, orderContribution, contributionReport };
