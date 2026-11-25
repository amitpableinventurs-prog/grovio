const jwt = require('jsonwebtoken');
const { hasFullAccess } = require('../utils/storeScope');
const { PERMISSIONS } = require('../utils/permissions');
const { logServerError } = require('../services/errorLog.service');

let io = null;

// Rooms every connection is placed in on connect (see initSocket below). Order broadcasts
// (orderEvents.js) target these instead of relying on clients to subscribe per-order:
//   user:<id>      — the customer / delivery partner / picker(s) on an order
//   orders:all     — admins with platform-wide MANAGE_ORDERS (or '*')
//   store:<id>     — a restricted store-manager admin, for orders their store is the hub of or
//                    contributes items to (same visibility as admin/orders.controller.js#listOrders)
//   order:<id>     — opt-in via 'order:subscribe', for live location pings on one order
//   hub:<storeId>  — Hub Center screens (models/hubDisplay.model.js) for that store; they get a
//                    minimal 'hub:order' ping (see orderEvents.js), never the full summary
//   display:<id>   — one hub screen: 'hub:qr' when its check-in QR was used, and revoking it
//                    disconnects it
//   support:agents — admins who answer support chats (manage_orders or '*'); the chat events of
//                    every ticket go here and to the ticket owner's user:<id> room
//                    (services/supportChat.service.js)
const ROOMS = {
  user: (id) => `user:${id}`,
  role: (role) => `role:${role}`,
  store: (id) => `store:${id}`,
  order: (id) => `order:${id}`,
  allOrders: 'orders:all',
  hub: (storeId) => `hub:${storeId}`,
  display: (id) => `display:${id}`,
  // Admins who see every SOS (services/sos.service.js); store managers get their store's in store:<id>.
  sosAll: 'sos:all',
  supportAgents: 'support:agents',
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
    // Hub Center screens connect with their device key instead of a user JWT.
    const hubDisplayKey = socket.handshake.auth?.hubDisplayKey;
    if (hubDisplayKey) {
      try {
        const { findDisplayByKey } = require('../services/hubDisplay.service');
        const display = await findDisplayByKey(hubDisplayKey);
        if (!display) return next(new Error('Hub screen key is invalid or revoked'));
        socket.hubDisplay = { id: display.id, store: display.store._id.toString() };
        return next();
      } catch (err) {
        return next(new Error('Authentication failed'));
      }
    }

    let decoded;
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication token missing'));
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }

    try {
      const user = await User.findById(decoded.id).select('name role permissions assignedStore isActive');
      if (!user) return next(new Error('User no longer exists'));
      if (!user.isActive) return next(new Error('Account has been disabled'));
      socket.user = {
        id: user.id,
        name: user.name || null,
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
    if (socket.hubDisplay) {
      socket.join(ROOMS.hub(socket.hubDisplay.store));
      socket.join(ROOMS.display(socket.hubDisplay.id));
      return;
    }

    const { id, role } = socket.user;
    socket.join(ROOMS.user(id));
    socket.join(ROOMS.role(role));

    if (role === 'admin') {
      if (hasFullAccess(socket.user, PERMISSIONS.MANAGE_ORDERS)) socket.join(ROOMS.allOrders);
      else if (socket.user.assignedStore) socket.join(ROOMS.store(socket.user.assignedStore));
      const sosPerms = [PERMISSIONS.MANAGE_ORDERS, PERMISSIONS.MANAGE_DELIVERY, PERMISSIONS.MANAGE_PICKERS];
      if (sosPerms.some((perm) => hasFullAccess(socket.user, perm))) socket.join(ROOMS.sosAll);
      if (hasFullAccess(socket.user, PERMISSIONS.MANAGE_ORDERS)) socket.join(ROOMS.supportAgents);
    }

    // ---- Support chat (services/supportChat.service.js) ----
    // The ticket owner (customer / rider / picker) or a support agent (admin). Every handler takes
    // an optional ack: ({ ok: true, ... }) or ({ ok: false, message }).
    const chat = () => require('../services/supportChat.service');
    // ticketId -> { side, owner, at }: so typing pings don't need a DB check each time.
    const sideCache = new Map();
    const remember = (ticket, side) => {
      const entry = { side, owner: String(ticket.user), at: Date.now() };
      sideCache.set(String(ticket._id), entry);
      return entry;
    };
    const ackOf = (ack) => (typeof ack === 'function' ? ack : () => {});
    const failed = (reply, err) => reply({ ok: false, message: err.statusCode && err.statusCode < 500 ? err.message : 'Something went wrong' });

    // support:send { ticketId, text, clientId? } -> ack { ok, message, status, clientId }
    socket.on('support:send', async (payload, ack) => {
      const reply = ackOf(ack);
      try {
        const { ticketId, text, clientId } = payload || {};
        const { ticket, side } = await chat().ticketFor(socket.user, ticketId);
        remember(ticket, side);
        const { message } = await chat().postMessage({ ticket, side, senderName: side === 'user' ? socket.user.name : null, text, clientId: clientId ? String(clientId).slice(0, 64) : null });
        reply({ ok: true, message: chat().messageView(message), status: ticket.status, clientId: clientId || null });
      } catch (err) {
        if (!err.statusCode) logServerError('support:send failed', err);
        failed(reply, err);
      }
    });

    // support:typing { ticketId, typing } -> the other side gets support:typing
    socket.on('support:typing', async (payload, ack) => {
      const reply = ackOf(ack);
      try {
        const { ticketId, typing } = payload || {};
        let entry = sideCache.get(String(ticketId));
        if (!entry || Date.now() - entry.at > 5 * 60 * 1000) {
          const { ticket, side } = await chat().ticketFor(socket.user, ticketId);
          entry = remember(ticket, side);
        }
        chat().emitTyping({ _id: String(ticketId), user: entry.owner }, entry.side, socket.user.name, typing);
        reply({ ok: true });
      } catch (err) {
        failed(reply, err);
      }
    });

    // support:read { ticketId } -> marks it read for my side; the other side gets support:read
    socket.on('support:read', async (payload, ack) => {
      const reply = ackOf(ack);
      try {
        const { ticket, side } = await chat().ticketFor(socket.user, (payload || {}).ticketId);
        remember(ticket, side);
        const at = await chat().markRead(ticket, side);
        reply({ ok: true, at });
      } catch (err) {
        failed(reply, err);
      }
    });

    // Rider GPS ping { lat, lng } (an orderId in the payload is ignored). Goes through the same
    // path as POST /delivery/location: stored, geofenced, and pushed with an ETA only to the
    // orders this rider is actually assigned to — see services/tracking.service.js.
    socket.on('delivery:location', (payload) => {
      if (role !== 'delivery') return;
      const { lat, lng } = payload || {};
      require('../services/tracking.service').handleRiderLocation(id, lat, lng)
        .catch((err) => logServerError('delivery:location failed', err));
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

// Force-disconnects every socket in a room (e.g. a revoked hub screen).
function disconnectRoom(room) {
  if (!io) return;
  io.in(room).disconnectSockets(true);
}

module.exports = { initSocket, getIO, emitOrderEvent, emitToRooms, disconnectRoom, ROOMS, canViewOrder };
