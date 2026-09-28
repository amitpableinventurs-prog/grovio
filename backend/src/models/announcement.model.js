const { Schema, model } = require('mongoose');

// A notice from the company to delivery partners / pickers / customers ("महत्वपूर्ण सूचना"),
// shown in the app's Updates tab with a Details page (services/announcement.service.js).
// `body` is plain text with light formatting: **bold**, lines starting with "* ", "• " or "- "
// as bullets, and blank lines between paragraphs.
const announcementSchema = new Schema({
  title: { type: String, required: true },
  // One-line preview for the list; defaults to the start of the body.
  summary: { type: String, default: null },
  body: { type: String, required: true },
  // Optional banner image at the top of the details page ('/uploads/…').
  image: { type: String, default: null },
  category: { type: String, enum: ['important', 'payments', 'process', 'earnings', 'safety', 'general'], default: 'important' },
  audience: {
    roles: { type: [{ type: String, enum: ['delivery', 'picker', 'customer'] }], default: ['delivery'] },
    // Only partners working at these stores; empty = every store.
    stores: { type: [{ type: Schema.Types.ObjectId, ref: 'Store' }], default: [] },
    // Only these people; empty = everyone in the roles above.
    users: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  pinned: { type: Boolean, default: false },
  // The partner must tap the button at the bottom to confirm they've read it.
  requireAck: { type: Boolean, default: false },
  ackLabel: { type: String, default: 'Okay, I understand' },
  cta: {
    label: { type: String, default: null },
    url: { type: String, default: null },
  },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  // Shown from publishAt (null = when published) until expiresAt (null = no end).
  publishAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  // Push a notification to the audience when it goes live.
  sendPush: { type: Boolean, default: true },
  notifiedAt: { type: Date, default: null },
  // Stable id for seeded notices, so seeding twice doesn't duplicate them.
  // No default: a sparse unique index still counts null, so it must stay unset when unused.
  key: { type: String, unique: true, sparse: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

announcementSchema.index({ status: 1, 'audience.roles': 1, publishedAt: -1 });

module.exports = model('Announcement', announcementSchema);
