const { Schema, model } = require('mongoose');

// A delivery partner's booking of a GigSlot (services/gig.service.js).
//   booked     -> upcoming or in progress
//   completed  -> online >= the gig's minLoginMinutes inside it (any time, for a free gig)
//   incomplete -> ended short of that
//   cancelled  -> cancelled by the partner before it started, or the admin cancelled the gig
// `exempted` (set by an admin) keeps an incomplete gig from counting against offer conditions.
const gigBookingSchema = new Schema({
  slot: { type: Schema.Types.ObjectId, ref: 'GigSlot', required: true },
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // Copied from the slot so history and offer windows can be queried without a join.
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  status: { type: String, enum: ['booked', 'completed', 'incomplete', 'cancelled'], default: 'booked' },
  exempted: { type: Boolean, default: false },
  exemptReason: { type: String, default: null },
  cancelledAt: { type: Date, default: null },
  // Frozen when the gig ends.
  loginMinutes: { type: Number, default: null },
  trips: { type: Number, default: null },
  earnings: { type: Number, default: null },
  finalizedAt: { type: Date, default: null },
}, { timestamps: true });

gigBookingSchema.index({ slot: 1, rider: 1 }, { unique: true });
gigBookingSchema.index({ rider: 1, startAt: -1 });
gigBookingSchema.index({ status: 1, endAt: 1 });

module.exports = model('GigBooking', gigBookingSchema);
