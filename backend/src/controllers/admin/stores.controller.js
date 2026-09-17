const { Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { logAdminActivity } = require('../../services/audit.service');
const { PERMISSIONS } = require('../../utils/permissions');

// GET /admin/stores?status=&zoneId=
const listStores = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, zoneId } = req.query;

  // An inventory-manager sub-admin only ever sees their own assigned store.
  const where = {};
  if (req.user.assignedStore && !req.user.permissions?.includes('*') && !req.user.permissions?.includes(PERMISSIONS.MANAGE_STORES)) {
    where._id = req.user.assignedStore;
  }
  if (status) where.status = status;
  if (zoneId) where.zoneId = zoneId;

  const [rows, count] = await Promise.all([
    Store.find(where).sort({ createdAt: -1 }).skip(offset).limit(limit),
    Store.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const getStore = catchAsync(async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) throw new ApiError(404, 'Store not found');
  new ApiResponse(200, store).send(res);
});

// POST /admin/stores  { name, address, lat, lng, description, zoneId, openTime, closeTime }
const createStore = catchAsync(async (req, res) => {
  const { name, address, lat, lng, description, zoneId, openTime, closeTime } = req.body;
  if (!name) throw new ApiError(400, 'name is required');

  const store = await Store.create({
    name,
    address,
    lat: lat || null,
    lng: lng || null,
    description,
    zoneId,
    openTime,
    closeTime,
    logo: req.files?.logo?.[0] ? `/uploads/${req.files.logo[0].filename}` : null,
    banner: req.files?.banner?.[0] ? `/uploads/${req.files.banner[0].filename}` : null,
  });

  await logAdminActivity({ adminId: req.user.id, action: 'store.create', entityType: 'Store', entityId: store._id });

  new ApiResponse(201, store, 'Store created').send(res);
});

// PATCH /admin/stores/:id  -> full store management (name/address/location/hours/zone/status/media)
const updateStore = catchAsync(async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) throw new ApiError(404, 'Store not found');

  const fields = ['name', 'address', 'lat', 'lng', 'description', 'zoneId', 'status', 'openTime', 'closeTime', 'isOpen'];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) store[f] = req.body[f];
  });
  if (req.files?.logo?.[0]) store.logo = `/uploads/${req.files.logo[0].filename}`;
  if (req.files?.banner?.[0]) store.banner = `/uploads/${req.files.banner[0].filename}`;
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

module.exports = { listStores, getStore, createStore, updateStore };
