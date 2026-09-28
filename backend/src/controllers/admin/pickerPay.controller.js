const { PickerError, PickerDay, User, PickerProfile, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { logAdminActivity } = require('../../services/audit.service');
const pickerPay = require('../../services/pickerPay.service');
const economics = require('../../services/orderEconomics.service');

// Admin: picker pay policy, picker earnings, picking errors, order contribution.

// GET /admin/picker-pay/policy
const getPolicy = catchAsync(async (req, res) => new ApiResponse(200, await pickerPay.getPolicy()).send(res));

// PUT /admin/picker-pay/policy { itemRates?: {...}, productivity?: [...], ... } — only what changes
const updatePolicy = catchAsync(async (req, res) => {
  const policy = await pickerPay.savePolicy(req.body || {});
  await logAdminActivity({ adminId: req.user.id, action: 'picker_pay.policy', metadata: req.body });
  new ApiResponse(200, policy, 'Picker pay policy saved').send(res);
});

async function findPicker(id) {
  const u = await User.findOne({ _id: id, role: 'picker' }).select('name phone');
  if (!u) throw new ApiError(404, 'Picker not found');
  return u;
}

// GET /admin/pickers/:id/earnings?date= — one day: live, or as settled
const pickerDay = catchAsync(async (req, res) => {
  const picker = await findPicker(req.params.id);
  const [day, orders] = await Promise.all([pickerPay.today(picker._id, req.query.date), pickerPay.orderEarnings(picker._id, req.query.date)]);
  new ApiResponse(200, { picker, day, orders }).send(res);
});

// GET /admin/pickers/:id/earning-days?from=&to= — settled days (audit trail)
const pickerDays = catchAsync(async (req, res) => {
  const picker = await findPicker(req.params.id);
  const where = { picker: picker._id };
  if (req.query.from || req.query.to) where.date = { ...(req.query.from ? { $gte: req.query.from } : {}), ...(req.query.to ? { $lte: req.query.to } : {}) };
  const days = await PickerDay.find(where).sort({ date: -1 }).limit(62).lean();
  new ApiResponse(200, { picker, days }).send(res);
});

// POST /admin/picker-pay/settle { date?, pickerId? } — settle now instead of waiting for the job
const settle = catchAsync(async (req, res) => {
  const { date, pickerId } = req.body || {};
  const result = pickerId && date ? await pickerPay.settleDay(pickerId, date) : await pickerPay.settleDue();
  new ApiResponse(200, result, 'Settled').send(res);
});

// POST /admin/picker-errors { orderId, pickerId, type, quantity?, amount?, note? }
const reportError = catchAsync(async (req, res) => {
  const err = await pickerPay.reportError({ ...req.body, reportedBy: req.user.id });
  new ApiResponse(201, err, 'Error reported — confirm or waive it after checking').send(res);
});

// GET /admin/picker-errors?status=&pickerId=
const listErrors = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.pickerId) where.picker = req.query.pickerId;
  const [rows, count] = await Promise.all([
    PickerError.find(where).populate('picker', 'name phone').populate('order', 'orderNumber').populate('store', 'name').sort({ createdAt: -1 }).skip(offset).limit(limit),
    PickerError.countDocuments(where),
  ]);
  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// PATCH /admin/picker-errors/:id { status: 'confirmed' | 'waived', amount? }
const reviewError = catchAsync(async (req, res) => {
  const err = await pickerPay.reviewError(req.params.id, { ...req.body, reviewedBy: req.user.id });
  await logAdminActivity({ adminId: req.user.id, action: 'picker_error.review', entityType: 'PickerError', entityId: err._id, metadata: { status: err.status, amount: err.amount } });
  new ApiResponse(200, err, err.status === 'confirmed' ? `Confirmed — ₹${err.amount} deducted` : 'Waived').send(res);
});

// GET/PUT /admin/order-economics — assumptions for the contribution report
const getEconomics = catchAsync(async (req, res) => new ApiResponse(200, await economics.getAssumptions()).send(res));
const updateEconomics = catchAsync(async (req, res) => new ApiResponse(200, await economics.saveAssumptions(req.body || {}), 'Saved').send(res));

// GET /admin/reports/order-contribution?from=&to=&storeId=&lossOnly=
const contribution = catchAsync(async (req, res) => new ApiResponse(200, await economics.contributionReport(req.query)).send(res));

// ---- Individual rates ---------------------------------------------------------------------------
// Body: only the parts that differ, e.g. { itemRates: { normal: 0.7 }, guarantee: { active: 400 } }.
// { reset: true } removes them all (back to the store's / default rates).

// GET /admin/pickers/:id/pay-policy -> own rates, store rates, and what actually applies
const getPickerPolicy = catchAsync(async (req, res) => {
  const picker = await findPicker(req.params.id);
  const profile = await PickerProfile.findOne({ user: picker._id }).select('store payPolicy').lean();
  const store = profile?.store ? await Store.findById(profile.store).select('name pickerPayPolicy').lean() : null;
  new ApiResponse(200, { picker, own: profile?.payPolicy || null, store: store ? { id: store._id, name: store.name, rates: store.pickerPayPolicy || null } : null, effective: await pickerPay.getPolicy(picker._id) }).send(res);
});
const setPickerPolicy = catchAsync(async (req, res) => {
  const picker = await findPicker(req.params.id);
  const own = await pickerPay.setPickerPolicy(picker._id, req.body?.reset ? null : req.body);
  await logAdminActivity({ adminId: req.user.id, action: 'picker_pay.picker_rates', entityType: 'User', entityId: picker._id, metadata: req.body });
  new ApiResponse(200, { own, effective: await pickerPay.getPolicy(picker._id) }, own ? "Picker's own rates saved" : 'Back to store / default rates').send(res);
});

// GET/PUT /admin/stores/:id/picker-pay-policy -> rates for every picker at a store
const getStorePolicy = catchAsync(async (req, res) => {
  const store = await Store.findById(req.params.id).select('name pickerPayPolicy').lean();
  if (!store) throw new ApiError(404, 'Store not found');
  const base = await pickerPay.globalPolicy();
  new ApiResponse(200, { store: { id: store._id, name: store.name }, own: store.pickerPayPolicy || null, default: base }).send(res);
});
const setStorePolicy = catchAsync(async (req, res) => {
  const own = await pickerPay.setStorePolicy(req.params.id, req.body?.reset ? null : req.body);
  await logAdminActivity({ adminId: req.user.id, action: 'picker_pay.store_rates', entityType: 'Store', entityId: req.params.id, metadata: req.body });
  new ApiResponse(200, { own }, own ? 'Store rates saved' : 'Back to default rates').send(res);
});

module.exports = {
  getPickerPolicy,
  setPickerPolicy,
  getStorePolicy,
  setStorePolicy,
  getPolicy,
  updatePolicy, pickerDay, pickerDays, settle, reportError, listErrors, reviewError, getEconomics, updateEconomics, contribution };
