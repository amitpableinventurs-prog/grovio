const {
  Store, Order, GigSlot, Product, HubDisplay, ColdBag, User, PickerProfile, DeliveryProfile, Announcement, SosAlert, PickerError,
} = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { logAdminActivity } = require('../../services/audit.service');
const { PERMISSIONS } = require('../../utils/permissions');
const { resolveStoreScope } = require('../../utils/storeScope');
const { searchPlaces } = require('../../services/geocode.service');

// GET /admin/stores?status=&zoneId=
const listStores = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, zoneId } = req.query;

  // An inventory-manager sub-admin only ever sees their own assigned store (and none at all once
  // it's unassigned, e.g. after deleteStore).
  const where = {};
  const scopedStoreId = resolveStoreScope(req.user, null, PERMISSIONS.MANAGE_STORES);
  if (scopedStoreId) where._id = scopedStoreId;
  if (status) where.status = status;
  if (zoneId) where.zoneId = zoneId;

  const [rows, count] = await Promise.all([
    Store.find(where).sort({ createdAt: -1 }).skip(offset).limit(limit),
    Store.countDocuments(where),
  ]);

  // Who runs each store: the admin / vendor-panel accounts assigned to it (user.assignedStore).
  const managers = await User.find({ assignedStore: { $in: rows.map((s) => s._id) } }).select('name email assignedStore').lean();
  const items = rows.map((s) => ({
    ...s.toJSON(),
    managers: managers.filter((u) => String(u.assignedStore) === String(s._id)).map(({ _id, name, email }) => ({ _id, name, email })),
  }));

  new ApiResponse(200, { items, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const getStore = catchAsync(async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) throw new ApiError(404, 'Store not found');
  new ApiResponse(200, store).send(res);
});

// POST /admin/stores  { name, address, lat, lng, description, zoneId, openTime, closeTime }
const createStore = catchAsync(async (req, res) => {
  const { name, address, lat, lng, description, zoneId, openTime, closeTime, serviceRadiusKm } = req.body;
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
    serviceRadiusKm: serviceRadiusKm === undefined || serviceRadiusKm === '' ? null : serviceRadiusKm,
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

  const fields = ['name', 'address', 'lat', 'lng', 'description', 'zoneId', 'status', 'openTime', 'closeTime', 'isOpen', 'serviceRadiusKm'];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) store[f] = req.body[f];
  });
  // Blank from a form means "no store-specific limit" (falls back to defaultServiceRadiusKm).
  if (req.body.serviceRadiusKm === '') store.serviceRadiusKm = null;
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

// DELETE /admin/stores/:id  -> refused once the store has order or gig history (deactivate it
// instead, so that history keeps its store). Otherwise its products, hub screens and cold bags go
// with it, and staff/pickers/riders linked to it are unlinked, not deleted.
const deleteStore = catchAsync(async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) throw new ApiError(404, 'Store not found');

  const [orderCount, gigSlotCount] = await Promise.all([
    Order.countDocuments({ store: store._id }),
    GigSlot.countDocuments({ store: store._id }),
  ]);
  if (orderCount || gigSlotCount) {
    const history = [orderCount && `${orderCount} order(s)`, gigSlotCount && `${gigSlotCount} gig slot(s)`].filter(Boolean).join(' and ');
    throw new ApiError(400, `Cannot delete — this store has ${history}. Deactivate it instead.`);
  }

  await Promise.all([
    Product.deleteMany({ store: store._id }),
    HubDisplay.deleteMany({ store: store._id }),
    ColdBag.deleteMany({ store: store._id }),
    User.updateMany({ assignedStore: store._id }, { assignedStore: null }),
    PickerProfile.updateMany({ store: store._id }, { store: null }),
    DeliveryProfile.updateMany(
      { 'hubCheckin.store': store._id },
      { 'hubCheckin.store': null, 'hubCheckin.display': null, 'hubCheckin.at': null, 'hubCheckin.expiresAt': null }
    ),
    Announcement.updateMany({ stores: store._id }, { $pull: { stores: store._id } }),
    SosAlert.updateMany({ store: store._id }, { store: null }),
    PickerError.updateMany({ store: store._id }, { store: null }),
  ]);
  await store.deleteOne();

  await logAdminActivity({
    adminId: req.user.id,
    action: 'store.delete',
    entityType: 'Store',
    entityId: store._id,
    metadata: { name: store.name },
  });

  new ApiResponse(200, null, 'Store deleted').send(res);
});

// GET /admin/places?q= -> [{ label, lat, lng }] for the store form's location search
// (services/geocode.service.js).
const placeSearch = catchAsync(async (req, res) => {
  new ApiResponse(200, await searchPlaces(req.query.q)).send(res);
});

module.exports = { listStores, getStore, createStore, updateStore, deleteStore, placeSearch };
