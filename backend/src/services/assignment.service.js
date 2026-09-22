const { PickerProfile, DeliveryProfile } = require('../models');

function distance(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined)) return Infinity;
  const dx = lat1 - lat2;
  const dy = lng1 - lng2;
  return Math.sqrt(dx * dx + dy * dy);
}

// Splits an order's items round-robin across up to `maxPickers` available (approved, online)
// pickers at the store, and creates the matching pickTasks — each picker then only works the
// items assigned to them (see picker.controller.js#scanItem/completeMyPicking). Mutates `order`
// in place (items[].assignedPicker, pickTasks) but does not save it, so the caller can do so as
// part of its own transitionOrder/save sequence. Returns the assigned picker user IDs (empty if
// none were available — the order still gets created, just with nobody to pick it yet).
async function splitOrderAcrossPickers(order, storeId, maxPickers = 3) {
  const pickers = await PickerProfile.find({ store: storeId, status: 'approved', isAvailable: true })
    .sort({ updatedAt: 1 })
    .limit(maxPickers);

  if (!pickers.length) return [];

  order.items.forEach((item, index) => {
    item.assignedPicker = pickers[index % pickers.length].user;
  });
  order.pickTasks = pickers.map((p) => ({ picker: p.user, status: 'assigned' }));

  return pickers.map((p) => p.user);
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

module.exports = { splitOrderAcrossPickers, findNearestDeliveryPartner };
