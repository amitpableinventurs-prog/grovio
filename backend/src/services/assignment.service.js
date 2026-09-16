const { PickerProfile, DeliveryProfile } = require('../models');

function distance(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined)) return Infinity;
  const dx = lat1 - lat2;
  const dy = lng1 - lng2;
  return Math.sqrt(dx * dx + dy * dy);
}

// Picks the longest-idle available, approved picker attached to the store.
async function findAvailablePicker(storeId) {
  const picker = await PickerProfile.findOne({ store: storeId, status: 'approved', isAvailable: true }).sort({ updatedAt: 1 });
  return picker;
}

// Picks the nearest available, approved delivery partner to the vendor's coordinates.
async function findNearestDeliveryPartner({ lat, lng }) {
  const candidates = await DeliveryProfile.find({ status: 'approved', isAvailable: true });

  if (!candidates.length) return null;

  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = distance(lat, lng, c.currentLat, c.currentLng);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

module.exports = { findAvailablePicker, findNearestDeliveryPartner };
