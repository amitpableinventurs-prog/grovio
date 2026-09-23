const jwt = require('jsonwebtoken');
const { hasFullAccess } = require('../utils/storeScope');
const { PERMISSIONS } = require('../utils/permissions');

let io = null;

// Rooms every connection is placed in on connect (see initSocket below). Order broadcasts
// (orderEvents.js) target these instead of relying on clients to subscribe per-order:
//   user:<id>      — the customer / delivery partner / picker(s) on an order
//   orders:all     — admins with platform-wide MANAGE_ORDERS (or '*')
//   store:<id>     — a restricted store-manager admin, for orders their store is the hub of or
//                    contributes items to (same visibility as admin/orders.controller.js#listOrders)
//   order:<id>     — opt-in via 'order:subscribe', for live location pings on one order
const ROOMS = {
  user: (id) => `user:${id}`,
  role: (role) => `role:${role}`,
  store: (id) => `store:${id}`,
  order: (id) => `order:${id}`,
  allOrders: 'orders:all',
};

const idOf = (v) => (v && v._id ? v._id : v)?.toString();

// Mirrors the HTTP-side visibility rules: customer owns it, delivery partner is assigned to it,
// picker has a pickTask on it, or an admin who can see it under admin/orders.controller.js.
function canViewOrder(user, order) {
  const uid = user.id;
  switch (user.role) {
    case 'customer':
      return idOf(order.customer) === uid;
    case 'delivery':
      return idOf(order.delivery) === uid;
    case 'picker':
      return (order.pickTasks || []).some((t) => idOf(t.picker) === uid);
    case 'admin': {
      if (hasFullAccess(user, PERMISSIONS.MANAGE_ORDERS)) return true;
      const storeId = user.assignedStore;
      if (!storeId) return false;
      return idOf(order.store) === storeId || (order.items || []).some((i) => idOf(i.pickupStore) === storeId);
    }
    default:
      return false;
  }
}

function initSocket(server) {
  const { Server } = require('socket.io');
  // Required lazily — models/order.model.js pulls in orderEvents.js -> this file.
  const { User, Order } = require('../models');

  io = new Server(server, {
    cors: { origin: '*' },
  });

  // Same checks as middleware/auth.middleware.js#authenticate: a valid JWT alone isn't enough,
  // the user must still exist and be active.
  io.use(async (socket, next) => {
    let decoded;
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication token missing'));
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }

    try {
      const user = await User.findById(decoded.id).select('role permissions assignedStore isActive');
      if (!user) return next(new Error('User no longer exists'));
      if (!user.isActive) return next(new Error('Account has been disabled'));
      socket.user = {
        id: user.id,
        role: user.role,
        permissions: user.permissions || [],
        assignedStore: user.assignedStore ? user.assignedStore.toString() : null,
      };
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.user;
    socket.join(ROOMS.user(id));
    socket.join(ROOMS.role(role));

    if (role === 'admin') {
      if (hasFullAccess(socket.user, PERMISSIONS.MANAGE_ORDERS)) socket.join(ROOMS.allOrders);
      else if (socket.user.assignedStore) socket.join(ROOMS.store(socket.user.assignedStore));
    }

    socket.on('delivery:location', (payload) => {
      if (role !== 'delivery') return;
      const { orderId, lat, lng } = payload || {};
      if (!orderId) return;
      io.to(ROOMS.order(orderId)).emit('delivery:location', { orderId, lat, lng });
    });

    // Live picker GPS ping, relayed to anyone watching this order (e.g. admin's
    // consolidation monitoring view). Persisting to PickerProfile happens via
    // POST /picker/location — this event is just the real-time broadcast.
    socket.on('picker:location', (payload) => {
      if (role !== 'picker') return;
      const { orderId, lat, lng } = payload || {};
      if (!orderId) return;
      io.to(ROOMS.order(orderId)).emit('picker:location', { orderId, pickerId: id, lat, lng });
    });

    // Joining an order room exposes live location pings, so it's gated on the same visibility as
    // fetching the order over HTTP. Optional ack: ({ ok: true }) or ({ ok: false, message }).
    socket.on('order:subscribe', async (orderId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!orderId || !/^[a-f\d]{24}$/i.test(String(orderId))) return reply({ ok: false, message: 'Invalid orderId' });
        const order = await Order.findById(orderId).select('customer delivery pickTasks.picker store items.pickupStore');
        if (!order) return reply({ ok: false, message: 'Order not found' });
        if (!canViewOrder(socket.user, order)) return reply({ ok: false, message: 'Not allowed to view this order' });
        socket.join(ROOMS.order(orderId));
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, message: 'Could not subscribe' });
      }
    });

    socket.on('order:unsubscribe', (orderId) => {
      if (orderId) socket.leave(ROOMS.order(orderId));
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}

function emitOrderEvent(orderId, event, payload) {
  if (!io) return;
  io.to(ROOMS.order(orderId)).emit(event, payload);
}

// Emits to the union of `rooms` — Socket.IO delivers once per socket even if it's in several.
function emitToRooms(rooms, event, payload) {
  if (!io || !rooms.length) return;
  io.to(rooms).emit(event, payload);
}

module.exports = { initSocket, getIO, emitOrderEvent, emitToRooms, ROOMS, canViewOrder };
