const { Setting } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');

const getSettings = catchAsync(async (req, res) => {
  const settings = await Setting.find();
  const map = {};
  settings.forEach((s) => { map[s.key] = s.value; });
  new ApiResponse(200, map).send(res);
});

// PUT /admin/settings  { deliveryFee: '25', commissionPercent: '10', ... }
const updateSettings = catchAsync(async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [key, value] of entries) {
    await Setting.findOneAndUpdate({ key }, { value: String(value) }, { upsert: true, new: true });
  }
  new ApiResponse(200, req.body, 'Settings updated').send(res);
});

module.exports = { getSettings, updateSettings };
