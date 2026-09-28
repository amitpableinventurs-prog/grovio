const { User, DeliveryProfile, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const t = require('../../utils/localTime');
const { logAdminActivity } = require('../../services/audit.service');
const riderPay = require('../../services/riderPay.service');

// Admin: delivery partner KM + incentive pay (services/riderPay.service.js) — the rate card, a
// partner's own rates, hub rain / surge, pay preview and the daily / weekly incentive periods.

async function findRider(id) {
  const rider = await User.findOne({ _id: id, role: 'delivery' }).select('name phone');
  if (!rider) throw new ApiError(404, 'Delivery partner not found');
  return rider;
}

// GET /admin/rider-pay/policy
const getPolicy = catchAsync(async (req, res) => {
  new ApiResponse(200, { policy: await riderPay.getPolicy(), defaults: riderPay.DEFAULT_POLICY }).send(res);
});

// PUT /admin/rider-pay/policy { kmSlabs?, peak?, daily?, … } — only the sections that change
const updatePolicy = catchAsync(async (req, res) => {
  const policy = await riderPay.savePolicy(req.body || {});
  await logAdminActivity({ adminId: req.user.id, action: 'rider_pay.policy', metadata: req.body });
  new ApiResponse(200, policy, 'Delivery partner rate card saved').send(res);
});

// GET /admin/rider-pay/preview?km=4.2&kg=12&time=19:30&storeId=&riderId= -> one order's pay
const previewPay = catchAsync(async (req, res) => {
  const policy = await riderPay.getPolicy(req.query.riderId || null);
  const [h, m] = String(req.query.time || '').split(':').map(Number);
  const at = Number.isFinite(h) ? t.atTime(new Date(), `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`) : new Date();
  const store = req.query.storeId ? await Store.findById(req.query.storeId).select('riderConditions').lean() : null;
  const conditions = req.query.rain || req.query.surge
    ? { rain: riderPay.RAIN_LEVELS.includes(req.query.rain) ? req.query.rain : 'none', surge: riderPay.SURGE_LEVELS.includes(req.query.surge) ? req.query.surge : 'none' }
    : riderPay.activeConditions(store, at);
  const kg = req.query.kg === undefined || req.query.kg === '' ? null : Number(req.query.kg);
  new ApiResponse(200, riderPay.quote(policy, { km: Number(req.query.km) || 0, distanceSource: 'preview', weightKg: Number.isFinite(kg) ? kg : null, at, conditions })).send(res);
});

// POST /admin/rider-pay/settle -> settle finished days / weeks now (normally every 5 minutes)
const settle = catchAsync(async (req, res) => {
  const settled = await riderPay.settleDue();
  new ApiResponse(200, { settled }, `${settled} period(s) settled`).send(res);
});

// GET /admin/rider-pay/periods?status=withheld&kind=day|week&riderId=
const listPeriods = catchAsync(async (req, res) => {
  new ApiResponse(200, await riderPay.listPeriods(req.query)).send(res);
});

// GET /admin/rider-pay/conditions -> every active hub's rain / surge
const listConditions = catchAsync(async (req, res) => new ApiResponse(200, await riderPay.listConditions()).send(res));

// PUT /admin/stores/:id/rider-conditions { rain: none|normal|heavy|severe, surge: none|high, until? }
const setConditions = catchAsync(async (req, res) => {
  const view = await riderPay.setConditions(req.params.id, req.body || {}, req.user.id);
  await logAdminActivity({ adminId: req.user.id, action: 'rider_pay.conditions', entityType: 'Store', entityId: req.params.id, metadata: req.body });
  new ApiResponse(200, view, 'Hub conditions updated').send(res);
});

// GET/PUT /admin/delivery-partners/:id/pay -> this partner's own rate card values
const getRiderPay = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const profile = await DeliveryProfile.findOne({ user: rider._id }).select('payOverride').lean();
  new ApiResponse(200, { rider, own: profile?.payOverride || null, effective: await riderPay.getPolicy(rider._id), sections: Object.keys(riderPay.DEFAULT_POLICY) }).send(res);
});
const setRiderPay = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const own = await riderPay.setRiderOverride(rider._id, req.body?.reset ? null : req.body);
  await logAdminActivity({ adminId: req.user.id, action: 'delivery.pay_rates', entityType: 'User', entityId: rider._id, metadata: req.body });
  new ApiResponse(200, { own, effective: await riderPay.getPolicy(rider._id) }, own ? "Partner's own rates saved" : 'Back to default rates').send(res);
});

// GET /admin/delivery-partners/:id/pay-periods?kind=day|week -> live day / week + settled periods
const riderPeriods = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  new ApiResponse(200, { rider, ...(await riderPay.periodsForRider(rider._id, req.query)) }).send(res);
});

// POST /admin/delivery-partners/:id/pay-periods/:kind/:key/withhold { reason }
const withholdPeriod = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const doc = await riderPay.withholdPeriod(rider._id, req.params.kind, req.params.key, { reason: req.body?.reason, by: req.user.id });
  await logAdminActivity({ adminId: req.user.id, action: 'rider_pay.withhold', entityType: 'User', entityId: rider._id, metadata: { kind: req.params.kind, key: req.params.key, reason: req.body?.reason } });
  new ApiResponse(200, doc, 'Incentives withheld').send(res);
});

// POST /admin/delivery-partners/:id/pay-periods/:kind/:key/release { note? }
const releasePeriod = catchAsync(async (req, res) => {
  const rider = await findRider(req.params.id);
  const doc = await riderPay.releasePeriod(rider._id, req.params.kind, req.params.key, { note: req.body?.note || null, by: req.user.id });
  await logAdminActivity({ adminId: req.user.id, action: 'rider_pay.release', entityType: 'User', entityId: rider._id, metadata: { kind: req.params.kind, key: req.params.key, note: req.body?.note } });
  new ApiResponse(200, doc, doc.payoutStatus === 'paid' ? `Released — ₹${doc.total} paid` : 'Released').send(res);
});

module.exports = { getPolicy, updatePolicy, previewPay, settle, listPeriods, listConditions, setConditions, getRiderPay, setRiderPay, riderPeriods, withholdPeriod, releasePeriod };
