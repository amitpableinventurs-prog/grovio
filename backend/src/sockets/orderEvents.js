const { emitToRooms, ROOMS } = require('./index');

// Real-time order feed. Every Order save (see the post('save') hook in models/order.model.js)
// lands here, so any code path that changes an order — status transitions, payment updates,
// delivery (un)assignment, pick-task progress, arrival timestamps — reaches connected clients
// without each controller having to remember to emit.
//
// Events (to every party allowed to see the order — see ROOMS in ./index.js):
//   order:created  { ...summary }  — first save of a new order
//   order:updated  { ...summary }  — any later save
// The payload is a lightweight summary, not the full order: clients use it to update lists in
// place or refetch the detail over HTTP (which applies the normal per-role response shaping).

// Several saves often happen back-to-back in one request (e.g. transitionOrder() then a
// paymentStatus update), so saves are coalesced per order and flushed once after a short delay.
const COALESCE_MS = 50;
const pending = new Map(); // orderId -> { order, created }

const idOf = (v) => (v && v._id ? v._id : v)?.toString() ?? null;

function summarize(order) {
  return {
    orderId: idOf(order),
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    grandTotal: order.grandTotal,
    customer: idOf(order.customer),
    store: idOf(order.store),
    delivery: idOf(order.delivery),
    pickTasks: (order.pickTasks || []).map((t) => ({ picker: idOf(t.picker), store: idOf(t.store), status: t.status })),
    updatedAt: order.updatedAt,
  };
}

function roomsFor(order) {
  const rooms = new Set([ROOMS.order(idOf(order)), ROOMS.allOrders]);
  if (order.customer) rooms.add(ROOMS.user(idOf(order.customer)));
  if (order.delivery) rooms.add(ROOMS.user(idOf(order.delivery)));
  (order.pickTasks || []).forEach((t) => rooms.add(ROOMS.user(idOf(t.picker))));
  if (order.store) rooms.add(ROOMS.store(idOf(order.store)));
  (order.items || []).forEach((i) => i.pickupStore && rooms.add(ROOMS.store(idOf(i.pickupStore))));
  return [...rooms];
}

function flush(orderId) {
  const entry = pending.get(orderId);
  pending.delete(orderId);
  if (!entry) return;
  const { order, created, previousRooms } = entry;
  // Include rooms from before the change too, so e.g. a delivery partner who just rejected the
  // job (order.delivery -> null) still hears about it.
  const rooms = [...new Set([...previousRooms, ...roomsFor(order)])];
  emitToRooms(rooms, created ? 'order:created' : 'order:updated', summarize(order));
}

function publishOrderChange(order, { created = false, previousRooms = [] } = {}) {
  const orderId = idOf(order);
  const existing = pending.get(orderId);
  if (existing) {
    existing.order = order;
    existing.created = existing.created || created;
    existing.previousRooms.push(...previousRooms);
    return;
  }
  pending.set(orderId, { order, created, previousRooms: [...previousRooms] });
  setTimeout(() => flush(orderId), COALESCE_MS).unref?.();
}

module.exports = { publishOrderChange, roomsFor, summarize };
