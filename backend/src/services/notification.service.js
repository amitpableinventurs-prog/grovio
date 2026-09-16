const { Notification } = require('../models');
const { getIO } = require('../sockets');

async function notifyUser(userId, { title, body, type = 'general', data = {} }) {
  const notification = await Notification.create({ user: userId, title, body, type, data });

  try {
    const io = getIO();
    io.to(`user:${userId}`).emit('notification', {
      id: notification.id,
      title,
      body,
      type,
      data,
      createdAt: notification.createdAt,
    });
  } catch (err) {
    // Socket layer not initialized (e.g. during seeding) — safe to ignore.
  }

  // TODO: send push notification via FCM using the user's stored fcmToken.
  return notification;
}

module.exports = { notifyUser };
