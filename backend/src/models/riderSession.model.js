const { Schema, model } = require('mongoose');

// One stretch of a delivery partner being online (PATCH /delivery/availability on -> off). These
// are the "login hours" behind Session History, gig completion and offers' compulsory login.
// endedAt null = still online.
const riderSessionSchema = new Schema({
  rider: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
}, { timestamps: true });

riderSessionSchema.index({ rider: 1, startedAt: -1 });
riderSessionSchema.index({ rider: 1, endedAt: 1 });

module.exports = model('RiderSession', riderSessionSchema);
