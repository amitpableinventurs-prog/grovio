const { Schema, model } = require('mongoose');

// One delivery partner's day or week of incentives (services/riderPay.service.js): the daily slab
// (with its Bronze … Diamond tier) and minimum-guarantee top-up for a day, the weekly slab for a
// week (Monday key). Worked out and credited once the period is over + settleDelayHours, only
// when the partner is eligible. Per-order pay (KM, peak, rain, heavy load, waiting, cancellation)
// is on each order (Order.riderPay) and only summarised in `figures`.
//
// payoutStatus: pending (not settled yet — e.g. a withhold lifted early) -> settling -> paid |
// nothing_due | not_eligible; or withheld by an admin (fraud, verified complaint) until released.
const lineSchema = new Schema({
  key: { type: String, required: true }, // daily_incentive | guarantee_topup | weekly_incentive
  label: { type: String, required: true },
  amount: { type: Number, required: true },
}, { _id: false });

const auditSchema = new Schema({
  action: { type: String, required: true }, // settled | withheld | released | calculated
  by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  note: { type: String, default: null },
  amount: { type: Number, default: null },
  at: { type: Date, default: Date.now },
}, { _id: false });

const riderPayPeriodSchema = new Schema({
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['day', 'week'], required: true },
  key: { type: String, required: true }, // local YYYY-MM-DD (a week's Monday)
  payoutStatus: { type: String, enum: ['pending', 'settling', 'paid', 'nothing_due', 'not_eligible', 'withheld'], default: 'pending' },
  figures: { type: Schema.Types.Mixed, default: null },
  lines: { type: [lineSchema], default: [] },
  eligibility: {
    status: { type: String, enum: [null, 'eligible', 'ineligible'], default: null },
    checks: { type: Schema.Types.Mixed, default: null },
    reasons: { type: [String], default: [] },
  },
  // Credited to the pocket (0 when not eligible / withheld).
  total: { type: Number, default: 0 },
  withheld: {
    type: new Schema({
      reason: { type: String, required: true },
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      at: { type: Date, default: Date.now },
    }, { _id: false }),
    default: null,
  },
  settledAt: { type: Date, default: null },
  audit: { type: [auditSchema], default: [] },
}, { timestamps: true });

riderPayPeriodSchema.index({ rider: 1, kind: 1, key: 1 }, { unique: true });
riderPayPeriodSchema.index({ payoutStatus: 1, updatedAt: -1 });

module.exports = model('RiderPayPeriod', riderPayPeriodSchema);
