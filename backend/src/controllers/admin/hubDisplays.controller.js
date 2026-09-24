const { HubDisplay, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { logAdminActivity } = require('../../services/audit.service');
const { resolveStoreScope } = require('../../utils/storeScope');
const { PERMISSIONS } = require('../../utils/permissions');
const { generateDisplayKey, hashKey, publicBaseUrl } = require('../../services/hubDisplay.service');
const { disconnectRoom, ROOMS } = require('../../sockets');

// Hub Center screens — see models/hubDisplay.model.js. A full MANAGE_STORES admin manages any
// store's screens; a store manager (MANAGE_OWN_STORE_INVENTORY) only their own store's.

// GET /admin/stores/:id/hub-displays -> this store's screens, revoked ones included (newest first)
const listHubDisplays = catchAsync(async (req, res) => {
  const storeId = resolveStoreScope(req.user, req.params.id, PERMISSIONS.MANAGE_STORES);
  const displays = await HubDisplay.find({ store: storeId })
    .populate('createdBy', 'name')
    .sort({ revokedAt: 1, createdAt: -1 });
  new ApiResponse(200, displays).send(res);
});

// POST /admin/stores/:id/hub-displays { name } -> creates a screen and returns its pairing link.
// The link carries the device key, which is never stored or shown again — to re-pair a screen,
// revoke it and add a new one.
const createHubDisplay = catchAsync(async (req, res) => {
  const storeId = resolveStoreScope(req.user, req.params.id, PERMISSIONS.MANAGE_STORES);
  const store = await Store.findById(storeId);
  if (!store) throw new ApiError(404, 'Store not found');

  const name = String(req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'name is required');

  const key = generateDisplayKey();
  const display = await HubDisplay.create({ store: store._id, name, keyHash: hashKey(key), createdBy: req.user.id });

  await logAdminActivity({ adminId: req.user.id, action: 'hub_display.create', entityType: 'HubDisplay', entityId: display._id, metadata: { store: store._id, name } });

  // Key in the URL fragment, so it never reaches server/proxy access logs.
  const pairingUrl = `${publicBaseUrl(req)}/hub-display/#key=${key}`;
  new ApiResponse(201, { display, pairingUrl }, 'Hub screen created').send(res);
});

// DELETE /admin/hub-displays/:id -> revokes the screen: its key and QR stop working at once and
// its live connection is dropped. Kept (not deleted) for the audit trail.
const revokeHubDisplay = catchAsync(async (req, res) => {
  const display = await HubDisplay.findById(req.params.id);
  if (!display) throw new ApiError(404, 'Hub screen not found');
  resolveStoreScope(req.user, display.store, PERMISSIONS.MANAGE_STORES);

  if (!display.revokedAt) {
    display.revokedAt = new Date();
    display.revokedBy = req.user.id;
    await display.save();
    disconnectRoom(ROOMS.display(display.id));
    await logAdminActivity({ adminId: req.user.id, action: 'hub_display.revoke', entityType: 'HubDisplay', entityId: display._id });
  }

  new ApiResponse(200, display, 'Hub screen revoked').send(res);
});

module.exports = { listHubDisplays, createHubDisplay, revokeHubDisplay };
