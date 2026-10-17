const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { getChargeConfig, saveChargeConfig } = require('../../services/charges.service');
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

module.exports = { getCharges, updateCharges };
