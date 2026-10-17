const { Schema, model } = require('mongoose');

// Result of an IncentiveOffer for one delivery partner, written when the offer is settled
// (services/offer.service.js#settleOffer). One per offer + partner, so settling twice never pays
// twice. Only partners with some activity in the offer get a row.
const offerPayoutSchema = new Schema({
  offer: { type: Schema.Types.ObjectId, ref: 'IncentiveOffer', required: true },
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // paid: credited to the wallet; disqualified: broke a condition / missed compulsory login;
  // not_achieved: no tier reached.
  status: { type: String, enum: ['paid', 'disqualified', 'not_achieved'], required: true },
  tierIndex: { type: Number, default: null },
  amount: { type: Number, default: 0 },
  reason: { type: String, default: null },
  // What the partner achieved, as of settlement.
  progress: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true });

offerPayoutSchema.index({ offer: 1, rider: 1 }, { unique: true });
offerPayoutSchema.index({ rider: 1, createdAt: -1 });

module.exports = model('OfferPayout', offerPayoutSchema);
