const { Notification, User } = require('../models');
const { getIO } = require('../sockets');
const { messaging, firebaseApp } = require('../config/firebase');

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

  // Push notification via FCM using the user's stored fcmToken
  if (messaging) {
    try {
      const user = await User.findById(userId).select('fcmToken');
      if (user?.fcmToken) {
        const payloadData = Object.fromEntries(
          Object.entries({ ...data, type, notificationId: String(notification._id) })
            .map(([k, v]) => [k, String(v ?? '')])
        );
        await messaging.send({
          token: user.fcmToken,
          notification: { title, body },
          data: payloadData,
        });
        console.log(`FCM push sent to user ${userId}`);
      }
    } catch (fcmErr) {
      console.warn(`Failed to send FCM push to user ${userId}:`, fcmErr.message);
    }
  }

  return notification;
}

module.exports = { notifyUser };
