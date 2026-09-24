const { Setting } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { invalidateSettingsCache } = require('../../services/settings.service');

// These hold API credentials — never returned in full once set. GET masks them down to the last
// 4 characters (enough for an admin to recognize "yes, that's the key I set" without exposing it);
// PUT silently ignores a blank/unchanged submission for these so the Settings page can leave them
// empty ("leave blank to keep existing") instead of round-tripping the masked placeholder back
// into the real value.
const SECRET_KEYS = [
  'razorpayKeySecret', 'razorpayWebhookSecret', 'smsApiKey', 'smsApiSecret', 'googleMapsApiKey',
  'payuSalt', 'phonepeClientSecret', 'phonepeWebhookPassword', 'exotelApiKey', 'exotelApiToken', 'ivrWebhookToken',
];

function maskSecret(value) {
  if (!value) return null;
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

const getSettings = catchAsync(async (req, res) => {
  const settings = await Setting.find();
  const map = {};
  settings.forEach((s) => { map[s.key] = s.value; });

  SECRET_KEYS.forEach((key) => { map[key] = maskSecret(map[key]); });

  new ApiResponse(200, map).send(res);
});

// PUT /admin/settings  { deliveryFee: '25', razorpayKeyId: '...', razorpayKeySecret: '...', ... }
const updateSettings = catchAsync(async (req, res) => {
  const entries = Object.entries(req.body);
  const applied = {};

  for (const [key, value] of entries) {
    if (SECRET_KEYS.includes(key) && !value) continue; // blank = "leave unchanged"
    await Setting.findOneAndUpdate({ key }, { value: String(value) }, { upsert: true, new: true });
    applied[key] = SECRET_KEYS.includes(key) ? maskSecret(String(value)) : value;
  }

  invalidateSettingsCache();
  new ApiResponse(200, applied, 'Settings updated').send(res);
});

module.exports = { getSettings, updateSettings };
