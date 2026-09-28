const { PickerProfile, DeliveryProfile } = require('../models');

function distance(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined)) return Infinity;
  const dx = lat1 - lat2;
  const dy = lng1 - lng2;
  return Math.sqrt(dx * dx + dy * dy);
}

// Splits an order's items round-robin across up to `maxPickers` available (approved, online)
// pickers PER STORE represented in the order (item.pickupStore) — a cart spanning multiple
// stores has one picker pool per store. Non-hub stores' pickers get their picked items to the
// hub (order.store) themselves; the delivery partner only ever collects once, at the hub (see
// delivery.controller.js#verifyHandoverOtpCtrl). Creates the matching pickTasks (one per assigned
// picker, tagged with which store they're working at) — each picker then only works the items
// assigned to them (see picker.controller.js#completeMyPicking). A store whose items end up with
// no available pickers is simply left unassigned, same as today's single-store "nobody available"
// case — those items just wait. Mutates `order` in place (items[].assignedPicker, pickTasks) but
// does not save it, so the caller can do so as part of its own transitionOrder/save sequence.
// Returns the assigned picker user IDs (empty if none were available anywhere).
async function splitOrderAcrossPickers(order, maxPickers = 3) {
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

    pickers.forEach((p) => {
      pickTasks.push({ picker: p.user, store: storeId, status: 'assigned' });
      assignedPickerIds.push(p.user);
    });
  }

  order.pickTasks = pickTasks;
  return assignedPickerIds;
}

// A picker turned down their part of `order` (picker.controller.js#rejectJob): hands each of
// their items to another picker at the same store, preferring an available picker who isn't on
// the order yet, then a teammate already working it there. `excludeIds` (the rejecting picker and
// anyone who turned this order down before) are never picked. Items nobody can take are left
// unassigned for an admin (PATCH /admin/orders/:id/assign-picker). Mutates `order` (items,
// pickTasks) without saving. Returns { assignedTo: [userId], unassignedItems }.
async function reassignPickerItems(order, fromPickerId, excludeIds = []) {
  const from = String(fromPickerId);
  const exclude = new Set([from, ...excludeIds.map(String)]);
  order.pickTasks = order.pickTasks.filter((t) => String(t.picker) !== from);

  const items = order.items.filter((i) => String(i.assignedPicker) === from);
  const byStore = new Map();
  items.forEach((i) => {
    const storeId = String(i.pickupStore);
    if (!byStore.has(storeId)) byStore.set(storeId, []);
    byStore.get(storeId).push(i);
  });

  const assignedTo = [];
  let unassignedItems = 0;
  for (const [storeId, storeItems] of byStore) {
    const onOrder = order.pickTasks.filter((t) => String(t.store) === storeId);
    const fresh = await PickerProfile.findOne({
      store: storeId,
      status: 'approved',
      isAvailable: true,
      user: { $nin: [...exclude, ...onOrder.map((t) => String(t.picker))] },
    }).sort({ updatedAt: 1 });

    let pickerId = fresh?.user || null;
    if (fresh) {
      order.pickTasks.push({ picker: fresh.user, store: storeId, status: 'assigned' });
    } else {
      // Nobody new — a teammate still picking this order at this store takes the items.
      const teammate = onOrder.find((t) => t.status !== 'completed' && !exclude.has(String(t.picker)));
      pickerId = teammate?.picker || null;
    }

    storeItems.forEach((i) => { i.assignedPicker = pickerId; });
    if (pickerId) assignedTo.push(pickerId);
    else unassignedItems += storeItems.length;
  }
  return { assignedTo, unassignedItems };
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

module.exports = { splitOrderAcrossPickers, reassignPickerItems, findNearestDeliveryPartner };
