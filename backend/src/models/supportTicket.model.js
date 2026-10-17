const { Schema, model } = require('mongoose');

// A help request from any app user (customer, delivery partner, picker) — see
// controllers/common/support.controller.js. A conversation: `messages` holds the user's and the
// support team's replies in order. `message` / `adminReply` are the first message and the latest
// reply, kept for older clients and the admin list.
const messageSchema = new Schema({
  sender: { type: String, enum: ['user', 'agent', 'system'], required: true },
  senderName: { type: String, default: null },
  text: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

const supportTicketSchema = new Schema({
  // Short number shown in the app ("Ticket ID - 134346138").
  ticketNumber: { type: String, unique: true, sparse: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // e.g. category 'past_order' / subcategory 'long_distance_return_pay' (see SUPPORT_CATEGORIES).
  category: { type: String, default: null },
  subcategory: { type: String, default: null },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  // What it's about, when raised from a trip / payout / offer screen.
  order: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  transfer: { type: Schema.Types.ObjectId, ref: 'PocketTransfer', default: null },
  offer: { type: Schema.Types.ObjectId, ref: 'IncentiveOffer', default: null },
  messages: { type: [messageSchema], default: [] },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
  adminReply: { type: String, default: null },
  closedAt: { type: Date, default: null },
  reopenedAt: { type: Date, default: null },
  // "How would you like to rate my assistance?"
  rating: { type: String, enum: [null, 'up', 'down'], default: null },
  ratedAt: { type: Date, default: null },
}, { timestamps: true });

supportTicketSchema.index({ user: 1, createdAt: -1 });

module.exports = model('SupportTicket', supportTicketSchema);
