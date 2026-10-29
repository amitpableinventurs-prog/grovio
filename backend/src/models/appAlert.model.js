const { Schema, model } = require('mongoose');

// A short alert the apps show across the top of their screens (banner) or once when opened
// (popup), e.g. "Heavy rain: deliveries may take longer today". Set from Admin > Alert Messages;
// the apps read the live ones with GET /common/alerts (services/appAlert.service.js).
// Not the Updates-tab notices: those are Announcements, with a details page.
const appAlertSchema = new Schema({
  title: { type: String, default: null },
  message: { type: String, required: true },
  severity: { type: String, enum: ['info', 'success', 'warning', 'critical'], default: 'info' },
  display: { type: String, enum: ['banner', 'popup'], default: 'banner' },
  apps: { type: [{ type: String, enum: ['customer', 'picker', 'delivery'] }], required: true },
  // The user may close it; the app remembers that per dismissKey (editing what it says shows it again).
  dismissible: { type: Boolean, default: true },
  cta: {
    label: { type: String, default: null },
    url: { type: String, default: null },
  },
  // Shown from startsAt (null = right away) until endsAt (null = until switched off).
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  // The admin's on/off switch.
  isActive: { type: Boolean, default: true },
  // Stable id for seeded alerts, so seeding twice doesn't duplicate them.
  // No default: a sparse unique index still counts null, so it must stay unset when unused.
  key: { type: String, unique: true, sparse: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

appAlertSchema.index({ isActive: 1, apps: 1 });

module.exports = model('AppAlert', appAlertSchema);
