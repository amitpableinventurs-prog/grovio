const { Schema, model } = require('mongoose');

// An incentive offer for delivery partners ("Earn upto ₹640 extra"), created by an admin
// (services/offer.service.js). Inside [startAt, endAt] a partner climbs tiers by completing gigs,
// delivering orders and/or reaching order earnings. When the offer ends they're paid the incentive
// of the highest tier reached, provided they kept to the conditions and did the compulsory login.
const tierSchema = new Schema({
  incentive: { type: Number, required: true },
  // Every non-null requirement must be met. null = not required.
  minGigs: { type: Number, default: null },
  minOrders: { type: Number, default: null },
  minEarnings: { type: Number, default: null },
}, { _id: false });

// Must be online at least minMinutes between from and to (local 'HH:mm'; a `to` earlier than
// `from` runs past midnight). Counted from the first `from` at/after the offer's start.
const loginWindowSchema = new Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  minMinutes: { type: Number, required: true },
}, { _id: false });

const incentiveOfferSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String, default: null },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  // Who it's for: listed delivery partners only, or every partner when empty.
  riders: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  tiers: { type: [tierSchema], default: [] },
  // "Don't do" conditions — exceeding any limit forfeits the whole offer. null = no limit.
  conditions: {
    maxOrderDenials: { type: Number, default: null },
    maxCancellations: { type: Number, default: null },
    maxIncompleteGigs: { type: Number, default: null },
  },
  // Optional voice explanation per condition (the audio player on the condition sheet).
  conditionAudio: {
    orderDenials: { type: String, default: null },
    cancellations: { type: String, default: null },
    incompleteGigs: { type: String, default: null },
  },
  compulsoryLogin: { type: [loginWindowSchema], default: [] },
  // "How does this offer work? Watch video to learn".
  videoUrl: { type: String, default: null },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  // Set once payouts have been made after endAt.
  settledAt: { type: Date, default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

incentiveOfferSchema.index({ startAt: 1, endAt: 1 });

module.exports = model('IncentiveOffer', incentiveOfferSchema);
