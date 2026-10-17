const { Schema, model } = require('mongoose');

// One masked in-app call between a customer and their delivery partner (services/voip.service.js).
// The call runs app to app over Twilio Voice, so neither side ever sees the other's phone number —
// the apps only know an opaque Twilio client identity. With no VoIP provider configured, calls are
// still recorded here with status 'simulated'.
const voipCallSchema = new Schema({
  order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  caller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  callerRole: { type: String, enum: ['customer', 'delivery'], required: true },
  callee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  calleeRole: { type: String, enum: ['customer', 'delivery'], required: true },
  provider: { type: String, enum: ['twilio', 'simulated'], required: true },
  // Twilio CallSid of the caller's leg, set when the app connects.
  providerCallId: { type: String, default: null, index: true },
  // initiated: created by the API, the app hasn't connected yet (expires after a couple of minutes).
  status: {
    type: String,
    enum: ['initiated', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed', 'canceled', 'expired', 'simulated'],
    default: 'initiated',
  },
  answeredAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  durationSec: { type: Number, default: null },
  error: { type: String, default: null },
}, { timestamps: true });

voipCallSchema.index({ caller: 1, status: 1 });

module.exports = model('VoipCall', voipCallSchema);
