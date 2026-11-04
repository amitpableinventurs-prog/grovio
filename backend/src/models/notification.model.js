const { Schema, model } = require('mongoose');

const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  type: { type: String, default: 'general' },
  data: { type: Schema.Types.Mixed, default: {} },
  isRead: { type: Boolean, default: false },
}, { timestamps: true });

// A user's notifications, newest first, and their unread count.
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });

module.exports = model('Notification', notificationSchema);
