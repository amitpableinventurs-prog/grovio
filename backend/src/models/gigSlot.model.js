const { Schema, model } = require('mongoose');

// A bookable delivery shift ("gig"), usually one hour, created by an admin (POST /admin/gigs/bulk).
// Delivery partners book gigs in the app (services/gig.service.js). A booked gig counts as
// completed when the partner is online for at least minLoginMinutes inside it. A free gig can be
// booked until it ends and, if it's left incomplete, is exempted instead of counting against them.
const gigSlotSchema = new Schema({
  // Hub the gig is for; null = any zone.
  store: { type: Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  // Expected earnings per hour, shown as "₹52 - ₹74 per hour". Informational only — the partner
  // is paid per order.
  payPerHourMin: { type: Number, default: null },
  payPerHourMax: { type: Number, default: null },
  // Max partners who can book it; null = unlimited.
  capacity: { type: Number, default: null },
  bookedCount: { type: Number, default: 0 },
  minLoginMinutes: { type: Number, default: 50 },
  // "Free Gig: No min. login hours required" — falling short carries no penalty.
  isFree: { type: Boolean, default: false },
  // Peak gig, shown with a star.
  isPriority: { type: Boolean, default: false },
  note: { type: String, default: null },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

gigSlotSchema.index({ startAt: 1, status: 1 });

module.exports = model('GigSlot', gigSlotSchema);
