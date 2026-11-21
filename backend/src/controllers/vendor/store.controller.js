const { Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { logAdminActivity } = require('../../services/audit.service');
const { HUB_PICKUP_MODES, getDefaultHubPickupMode } = require('../../services/hubDisplay.service');

// GET /vendor/store -> my store. Read-only here: name, location, hours and approval
// (status: 'inactive' until an admin activates it) are set by the admin (PATCH /admin/stores/:id).
const getMyStore = catchAsync(async (req, res) => {
  const store = await Store.findById(req.user.assignedStore);
  if (!store) throw new ApiError(404, 'Store not found');
  new ApiResponse(200, store).send(res);
});

// The admin hub-screen handlers take the store from req.params.id; on /vendor/hub-displays it's
// always the vendor's own store.
const useMyStore = (req, res, next) => {
  req.params.id = req.user.assignedStore.toString();
  next();
};

// { mode, defaultMode, effectiveMode }: mode is the store's own choice (null = follow the global
// "Hub pickup" setting, which is defaultMode); effectiveMode is what actually applies.
async function hubPickupState(store) {
  const defaultMode = await getDefaultHubPickupMode();
  const mode = store.hubPickupMode || null;
  return { mode, defaultMode, effectiveMode: mode || defaultMode };
}

// GET /vendor/store/hub-pickup -> how packed orders at my store get their rider.
const getHubPickup = catchAsync(async (req, res) => {
  const store = await Store.findById(req.user.assignedStore).select('hubPickupMode');
  if (!store) throw new ApiError(404, 'Store not found');
  new ApiResponse(200, await hubPickupState(store)).send(res);
});

// PATCH /vendor/store/hub-pickup { mode: 'hub_screen' | 'auto_assign' | null }
// null = use the Grovio default again. Applies to orders packed from now on.
const updateHubPickup = catchAsync(async (req, res) => {
  const { mode = null } = req.body;
  if (mode !== null && !HUB_PICKUP_MODES.includes(mode)) {
    throw new ApiError(400, `mode must be one of ${HUB_PICKUP_MODES.join(', ')}, or null for the default`);
  }
  const store = await Store.findById(req.user.assignedStore);
  if (!store) throw new ApiError(404, 'Store not found');

  const previous = store.hubPickupMode || null;
  store.hubPickupMode = mode;
  await store.save();

  if (previous !== mode) {
    await logAdminActivity({ adminId: req.user.id, action: 'store.hub_pickup_mode', entityType: 'Store', entityId: store._id, metadata: { from: previous, to: mode } });
  }
  new ApiResponse(200, await hubPickupState(store), 'Hub pickup updated').send(res);
});

module.exports = { getMyStore, useMyStore, getHubPickup, updateHubPickup };
