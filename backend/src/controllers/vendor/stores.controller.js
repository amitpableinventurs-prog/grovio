const { Vendor, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');

async function getVendorId(userId) {
  const vendor = await Vendor.findOne({ user: userId });
  if (!vendor) throw new ApiError(404, 'Vendor profile not found');
  return vendor._id;
}

const createStore = catchAsync(async (req, res) => {
  const vendorId = await getVendorId(req.user.id);
  const { name, description, address, lat, lng, zoneId, openTime, closeTime } = req.body;

  const store = await Store.create({ vendor: vendorId, name, description, address, lat, lng, zoneId, openTime, closeTime });
  new ApiResponse(201, store, 'Store created').send(res);
});

const listStores = catchAsync(async (req, res) => {
  const vendorId = await getVendorId(req.user.id);
  const stores = await Store.find({ vendor: vendorId }).sort({ createdAt: -1 });
  new ApiResponse(200, stores).send(res);
});

async function findOwnedStore(req) {
  const vendorId = await getVendorId(req.user.id);
  const store = await Store.findOne({ _id: req.params.id, vendor: vendorId });
  if (!store) throw new ApiError(404, 'Store not found');
  return store;
}

const getStore = catchAsync(async (req, res) => {
  const store = await findOwnedStore(req);
  new ApiResponse(200, store).send(res);
});

const updateStore = catchAsync(async (req, res) => {
  const store = await findOwnedStore(req);
  const { name, description, address, lat, lng, zoneId, openTime, closeTime } = req.body;

  if (req.files?.logo) store.logo = `/uploads/${req.files.logo[0].filename}`;
  if (req.files?.banner) store.banner = `/uploads/${req.files.banner[0].filename}`;
  if (name !== undefined) store.name = name;
  if (description !== undefined) store.description = description;
  if (address !== undefined) store.address = address;
  if (lat !== undefined) store.lat = lat;
  if (lng !== undefined) store.lng = lng;
  if (zoneId !== undefined) store.zoneId = zoneId;
  if (openTime !== undefined) store.openTime = openTime;
  if (closeTime !== undefined) store.closeTime = closeTime;
  await store.save();

  new ApiResponse(200, store, 'Store updated').send(res);
});

// PATCH /vendor/stores/:id/status  { isOpen }  -> quick open/close toggle
const updateStoreStatus = catchAsync(async (req, res) => {
  const store = await findOwnedStore(req);
  const { isOpen } = req.body;
  store.isOpen = !!isOpen;
  await store.save();
  new ApiResponse(200, store, `Store is now ${store.isOpen ? 'open' : 'closed'}`).send(res);
});

module.exports = { createStore, listStores, getStore, updateStore, updateStoreStatus };
