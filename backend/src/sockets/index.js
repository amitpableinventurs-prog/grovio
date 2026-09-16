const jwt = require('jsonwebtoken');

let io = null;

function initSocket(server) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: { origin: '*' },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication token missing'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.user;
    socket.join(`user:${id}`);
    socket.join(`role:${role}`);

    socket.on('delivery:location', (payload) => {
      if (role !== 'delivery') return;
      const { orderId, lat, lng } = payload || {};
      if (!orderId) return;
      io.to(`order:${orderId}`).emit('delivery:location', { orderId, lat, lng });
    });

    socket.on('order:subscribe', (orderId) => {
      if (orderId) socket.join(`order:${orderId}`);
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
  io.to(`order:${orderId}`).emit(event, payload);
}

module.exports = { initSocket, getIO, emitOrderEvent };
