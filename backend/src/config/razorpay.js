const Razorpay = require('razorpay');
const { getSetting } = require('../services/settings.service');

// Credentials can come from the Settings panel (DB) or .env — see settings.service.js. No
// singleton caching here: constructing a Razorpay client is just an object literal (no network
// call), and caching would mean a key changed in the panel wouldn't take effect until restart.
async function getRazorpayInstance() {
  const keyId = await getSetting('razorpayKeyId', 'RAZORPAY_KEY_ID');
  const keySecret = await getSetting('razorpayKeySecret', 'RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret) return null;

  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

module.exports = { getRazorpayInstance };
