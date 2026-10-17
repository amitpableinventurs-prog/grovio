const { getSetting } = require('./settings.service');
const { distanceKm } = require('../utils/geo');

// Road route between two points for the delivery app's map (the blue line + "13 mins | 4.3 km
// away"). Uses the Google Routes API in two-wheeler mode when a Google Maps key is set in
// Admin > Settings (the key's project needs the Routes API enabled); otherwise — or if Google
// fails — a straight-line x 1.3 estimate at the tracking speed, with no polyline.
//
// Results are cached for a minute per ~100 m of origin, so a rider re-opening the map doesn't
// cost a request each time.

const ROAD_FACTOR = 1.3;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;
const cache = new Map();

const r3 = (n) => Math.round(n * 1000) / 1000;
const round1 = (n) => Math.round(n * 10) / 10;

function estimate(from, to, speedKmph) {
  const d = distanceKm(from?.lat, from?.lng, to?.lat, to?.lng);
  if (!Number.isFinite(d)) return null;
  const km = round1(d * ROAD_FACTOR);
  return { distanceKm: km, etaMinutes: Math.max(1, Math.round((km * 60) / speedKmph)), polyline: null, source: 'estimate' };
}

async function googleRoute(from, to, key) {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: 'TWO_WHEELER',
      routingPreference: 'TRAFFIC_AWARE',
      languageCode: 'en-IN',
      units: 'METRIC',
    }),
    signal: AbortSignal.timeout(4000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Routes API HTTP ${res.status}`);
  const route = json.routes?.[0];
  if (!route) throw new Error('No route found');
  return {
    distanceKm: round1((route.distanceMeters || 0) / 1000),
    etaMinutes: Math.max(1, Math.round(parseInt(String(route.duration || '0s'), 10) / 60)),
    // Google encoded polyline — decode in the app (e.g. PolyUtil.decode) to draw the route.
    polyline: route.polyline?.encodedPolyline || null,
    source: 'google',
  };
}

let lastErrorLogged = 0;

// { distanceKm, etaMinutes, polyline, source: 'google' | 'estimate' } or null without coordinates.
async function route(from, to, { speedKmph = 20 } = {}) {
  if (![from?.lat, from?.lng, to?.lat, to?.lng].every(Number.isFinite)) return null;
  const key = await getSetting('googleMapsApiKey', 'GOOGLE_MAPS_API_KEY');
  if (!key) return estimate(from, to, speedKmph);

  const cacheKey = `${r3(from.lat)},${r3(from.lng)}>${r3(to.lat)},${r3(to.lng)}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  try {
    const value = await googleRoute(from, to, key);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    if (Date.now() - lastErrorLogged > 60_000) {
      console.warn('Google Routes API failed, using an estimate:', err.message);
      lastErrorLogged = Date.now();
    }
    return estimate(from, to, speedKmph);
  }
}

// Links that open turn-by-turn navigation in Google Maps.
function navigationLinks(from, to) {
  const dest = `${to.lat},${to.lng}`;
  const params = new URLSearchParams({ api: '1', destination: dest, travelmode: 'two-wheeler' });
  // Without an origin Google Maps starts from the phone's live location — better than a stale fix.
  if (from && Number.isFinite(from.lat) && !from.stale) params.set('origin', `${from.lat},${from.lng}`);
  return {
    googleMapsUrl: `https://www.google.com/maps/dir/?${params.toString()}`,
    // Android: starts navigation straight away, two-wheeler mode.
    androidIntent: `google.navigation:q=${dest}&mode=l`,
  };
}

module.exports = { route, navigationLinks, estimate };
