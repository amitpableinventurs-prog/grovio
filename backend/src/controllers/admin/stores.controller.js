const { Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { logAdminActivity } = require('../../services/audit.service');

// GET /admin/stores?vendorId=&status=&zoneId=
const listStores = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { vendorId, status, zoneId } = req.query;

  const where = {};
  if (vendorId) where.vendor = vendorId;
  if (status) where.status = status;
  if (zoneId) where.zoneId = zoneId;

  const [rows, count] = await Promise.all([
    Store.find(where).populate('vendor', 'businessName status').sort({ createdAt: -1 }).skip(offset).limit(limit),
    Store.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const getStore = catchAsync(async (req, res) => {
  const store = await Store.findById(req.params.id).populate('vendor');
  if (!store) throw new ApiError(404, 'Store not found');
  new ApiResponse(200, store).send(res);
});

// PATCH /admin/stores/:id  { zoneId, status, openTime, closeTime }  -> zones/timings/service config
const updateStore = catchAsync(async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) throw new ApiError(404, 'Store not found');

  ['zoneId', 'status', 'openTime', 'closeTime'].forEach((f) => {
    if (req.body[f] !== undefined) store[f] = req.body[f];
  });
  await store.save();

  await logAdminActivity({
    adminId: req.user.id,
    action: 'store.update',
    entityType: 'Store',
    entityId: store._id,
    metadata: req.body,
  });

  new ApiResponse(200, store, 'Store updated').send(res);
});

module.exports = { listStores, getStore, updateStore };
