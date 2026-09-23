const { Setting } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getChargeConfig, saveChargeConfig } = require('../../services/charges.service');
const { invalidateSettingsCache } = require('../../services/settings.service');
const { logAdminActivity } = require('../../services/audit.service');

// GET /admin/charges — delivery / handling / packing / surcharge config (see charges.service.js)
const getCharges = catchAsync(async (req, res) => {
  new ApiResponse(200, await getChargeConfig()).send(res);
});

// PUT /admin/charges  { delivery: { enabled, type, value, freeAbove }, handling: {...}, packing: {...}, surcharge: { ..., label } }
// Applies to every checkout from the next request on; already-placed orders keep their charges.
const updateCharges = catchAsync(async (req, res) => {
  const config = await saveChargeConfig(req.body || {});
  await logAdminActivity({ adminId: req.user.id, action: 'charges.update', entityType: 'Setting', metadata: config });
  new ApiResponse(200, config, 'Charges saved').send(res);
});

// GET /admin/order-settings — read by the Live Orders board.
const getOrderSettings = catchAsync(async (req, res) => {
  const row = await Setting.findOne({ key: 'autoAcceptOrders' });
  new ApiResponse(200, { autoAcceptOrders: row?.value === 'true' }).send(res);
});

// PUT /admin/order-settings  { autoAcceptOrders: boolean }
// Off (default): new orders wait at 'placed' on the Live Orders board until someone accepts them.
// On: orders are accepted and split to pickers the moment they're placed.
const updateOrderSettings = catchAsync(async (req, res) => {
  const { autoAcceptOrders } = req.body || {};
  if (typeof autoAcceptOrders !== 'boolean') throw new ApiError(422, 'autoAcceptOrders must be true or false');
  await Setting.findOneAndUpdate({ key: 'autoAcceptOrders' }, { value: String(autoAcceptOrders) }, { upsert: true });
  invalidateSettingsCache();
  await logAdminActivity({ adminId: req.user.id, action: 'orders.auto_accept', entityType: 'Setting', metadata: { autoAcceptOrders } });
  new ApiResponse(200, { autoAcceptOrders }, autoAcceptOrders ? 'Auto-accept turned on' : 'Auto-accept turned off').send(res);
});

module.exports = { getCharges, updateCharges, getOrderSettings, updateOrderSettings };
