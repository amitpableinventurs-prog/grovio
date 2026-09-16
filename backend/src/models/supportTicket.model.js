const { Schema, model } = require('mongoose');

const supportTicketSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
  adminReply: { type: String, default: null },
}, { timestamps: true });

module.exports = model('SupportTicket', supportTicketSchema);
