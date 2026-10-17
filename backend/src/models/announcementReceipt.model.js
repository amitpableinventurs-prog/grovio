const { Schema, model } = require('mongoose');

// Who opened (readAt) and confirmed (ackAt) an Announcement.
const announcementReceiptSchema = new Schema({
  announcement: { type: Schema.Types.ObjectId, ref: 'Announcement', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  readAt: { type: Date, default: null },
  ackAt: { type: Date, default: null },
}, { timestamps: true });

announcementReceiptSchema.index({ announcement: 1, user: 1 }, { unique: true });
announcementReceiptSchema.index({ user: 1 });

module.exports = model('AnnouncementReceipt', announcementReceiptSchema);
