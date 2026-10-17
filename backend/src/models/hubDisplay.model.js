const { Schema, model } = require('mongoose');

// A screen (TV/tablet) mounted at a Hub Center — the store orders are consolidated at
// (order.store) — that shows the hub's live pickup board and a check-in QR at
// /hub-display. Created by an admin per store; the screen authenticates with a long-lived device
// key (only its SHA-256 hash is stored here — the key itself is shown to the admin once, as part
// of the pairing link) rather than a user login. Revoking a screen cuts it off immediately.
//
// The check-in QR carries a single-use random token (checkinToken below): a Delivery Boy scans it
// from the delivery app to prove they are physically at this hub (POST /delivery/hub/checkin), and
// that check-in replaces it with a new one — see services/hubDisplay.service.js.
const hubDisplaySchema = new Schema({
  store: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
  name: { type: String, required: true },
  keyHash: { type: String, required: true, unique: true, select: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  lastSeenAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  // What the screen's QR currently encodes. No expiry — it's replaced when a check-in uses it.
  checkinToken: { type: String, default: null, index: true, select: false },
  checkinTokenIssuedAt: { type: Date, default: null, select: false },
}, { timestamps: true });

function stripSecrets(doc, ret) {
  delete ret.keyHash;
  delete ret.checkinToken;
  delete ret.checkinTokenIssuedAt;
  return ret;
}
hubDisplaySchema.set('toJSON', { transform: stripSecrets });
hubDisplaySchema.set('toObject', { transform: stripSecrets });

module.exports = model('HubDisplay', hubDisplaySchema);
