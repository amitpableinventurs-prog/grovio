const { Schema, model } = require('mongoose');

// One IVR call, outbound (we called the customer) or inbound (customer called / gave a missed
// call to our number). See services/ivr.service.js. With no IVR provider configured, outbound
// calls are still recorded here with status 'simulated', so the flows can be tested end to end.
const ivrCallSchema = new Schema({
  type: {
    type: String,
    enum: ['order_confirmation', 'status_update', 'delivery_alert', 'missed_call', 'missed_call_callback', 'customer_care'],
    required: true,
  },
  direction: { type: String, enum: ['outbound', 'inbound'], required: true },
  order: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  phone: { type: String, required: true },
  // What triggered an automatic call, e.g. 'out_for_delivery' or 'rider_nearby'.
  event: { type: String, default: null },
  // What the call says (read out by the provider's text-to-speech).
  message: { type: String, default: null },
  provider: { type: String, enum: ['exotel', 'simulated'], required: true },
  providerCallId: { type: String, default: null, index: true },
  status: {
    type: String,
    enum: ['queued', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'simulated'],
    default: 'queued',
  },
  // Keys the caller pressed, and what we did with them.
  dtmf: { type: String, default: null },
  outcome: { type: String, default: null },
  durationSec: { type: Number, default: null },
  error: { type: String, default: null },
}, { timestamps: true });

ivrCallSchema.index({ order: 1, event: 1 });

module.exports = model('IvrCall', ivrCallSchema);
