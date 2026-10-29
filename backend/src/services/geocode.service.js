const { getSetting } = require('./settings.service');
const ApiError = require('../utils/apiError');

// Place search, so an admin can set a store's location by typing an area / street / city instead
// of coordinates (GET /admin/places). Google Geocoding when a Maps key is set in Settings,
// otherwise OpenStreetMap's Nominatim — free, no key, but its usage policy asks for about one
// request a second and no search-as-you-type, so the admin panel searches on Enter. Results are
// cached for a day, so repeating a search doesn't go out again.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();
// Nominatim often takes 4–5 s from here.
const TIMEOUT_MS = 12000;

async function googleSearch(q, key) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?region=in&address=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
  const data = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).then((r) => r.json());
  if (!['OK', 'ZERO_RESULTS'].includes(data.status)) throw new Error(`Google Geocoding: ${data.status}`);
  return (data.results || []).slice(0, 6).map((r) => ({ label: r.formatted_address, lat: r.geometry.location.lat, lng: r.geometry.location.lng }));
}

async function nominatimSearch(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Grovio-Admin/1.0 (store location search)', 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
  return (await res.json()).map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}

// [{ label, lat, lng }] — at most 6, best match first.
async function searchPlaces(query) {
  const q = String(query || '').trim().slice(0, 200);
  if (q.length < 3) throw new ApiError(400, 'Type at least 3 letters — an area, street or city');

  const cacheKey = q.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.value;

  const key = await getSetting('googleMapsApiKey', 'GOOGLE_MAPS_API_KEY');
  let value;
  try {
    value = key ? await googleSearch(q, key) : await nominatimSearch(q);
  } catch (err) {
    console.warn('Place search failed:', err.message);
    throw new ApiError(502, 'Place search is not available right now. Try again in a moment, or drop the pin on the map.');
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

module.exports = { searchPlaces };
