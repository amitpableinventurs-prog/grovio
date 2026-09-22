const { PickerProfile, DeliveryProfile } = require('../models');

function distance(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined)) return Infinity;
  const dx = lat1 - lat2;
  const dy = lng1 - lng2;
  return Math.sqrt(dx * dx + dy * dy);
}

// Splits an order's items round-robin across up to `maxPickers` available (approved, online)
// pickers PER STORE represented in the order (item.pickupStore) — an order consolidated at a hub
// (order.store) can hold items from several stores, each with its own picker pool. Creates the
// matching pickTasks (one per assigned picker, tagged with which store they're working at) —
// each picker then only works the items assigned to them (see
// picker.controller.js#scanItem/completeMyPicking). A store whose items end up with no available
// pickers is simply left unassigned, same as today's single-store "nobody available" case — those
// items just wait. Mutates `order` in place (items[].assignedPicker, pickTasks) but does not save
// it, so the caller can do so as part of its own transitionOrder/save sequence. Returns the
// assigned picker user IDs (empty if none were available anywhere).
async function splitOrderAcrossPickers(order, maxPickers = 3) {
  const hubStoreId = order.store.toString();

  const itemIndexesByStore = new Map();
  order.items.forEach((item, index) => {
    const storeId = item.pickupStore.toString();
    if (!itemIndexesByStore.has(storeId)) itemIndexesByStore.set(storeId, []);
    itemIndexesByStore.get(storeId).push(index);
  });

  const pickTasks = [];
  const assignedPickerIds = [];

  for (const [storeId, itemIndexes] of itemIndexesByStore) {
    const pickers = await PickerProfile.find({ store: storeId, status: 'approved', isAvailable: true })
      .sort({ updatedAt: 1 })
      .limit(maxPickers);
    if (!pickers.length) continue;

    itemIndexes.forEach((itemIndex, i) => {
      order.items[itemIndex].assignedPicker = pickers[i % pickers.length].user;
    });

    const isHub = storeId === hubStoreId;
    pickers.forEach((p) => {
      pickTasks.push({ picker: p.user, store: storeId, status: 'assigned', handoffStatus: isHub ? 'not_required' : 'pending' });
      assignedPickerIds.push(p.user);
    });
  }

  order.pickTasks = pickTasks;
  return assignedPickerIds;
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
