const { Setting } = require('../models');

// Lets an admin set integration credentials (Razorpay, SMS, Google Maps) from the Settings panel
// instead of editing .env and redeploying. DB value wins when present; .env is just the initial/
// local-dev fallback. Cached briefly so hot paths (creating a Razorpay order, sending an OTP SMS)
// don't hit Mongo on every request — settings.controller.js invalidates this on every save.
let cache = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadCache() {
  const rows = await Setting.find();
  cache = {};
  rows.forEach((row) => { cache[row.key] = row.value; });
  cacheLoadedAt = Date.now();
}

async function getSetting(key, envFallbackKey) {
  if (!cache || Date.now() - cacheLoadedAt > CACHE_TTL_MS) {
    await loadCache();
  }
  if (cache[key]) return cache[key];
  return envFallbackKey ? process.env[envFallbackKey] || null : null;
}

function invalidateSettingsCache() {
  cache = null;
}

module.exports = { getSetting, invalidateSettingsCache };
