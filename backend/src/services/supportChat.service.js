const { SupportTicket } = require('../models');
const ApiError = require('../utils/apiError');
const { emitToRooms, ROOMS } = require('../sockets');
const { notifyUser } = require('./notification.service');
const { logServerError } = require('./errorLog.service');

// Live support chat. A support ticket (models/supportTicket.model.js) is the conversation; this
// adds messages and status changes to it and pushes them over Socket.IO, whether they came in over
// REST (controllers/common/support.controller.js) or the socket itself (sockets/index.js).
//
// Who hears what — no per-ticket subscription needed:
//   user:<ticket owner>   the customer / rider / picker who raised it (every app socket is in it)
//   support:agents        admins with manage_orders (or '*'), i.e. who can open /admin/support-tickets
//
// Server -> client events:
//   support:ticket   { ticketId, ticketNumber, subject, status, event, lastMessageAt, ... }
//                    event: created | status | reopened | rated
//   support:message  { ticketId, ticketNumber, status, message: { _id, sender, senderName, text,
//                      createdAt }, clientId }
//   support:typing   { ticketId, from: 'user' | 'agent', name, typing }
//   support:read     { ticketId, by: 'user' | 'agent', at }

const CLOSED = ['closed', 'resolved'];
const MAX_TEXT = 2000;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const idOf = (v) => (v && v._id ? v._id : v)?.toString();

// Can this socket / request user act as a support agent?
function isAgent(user) {
  const perms = user?.permissions || [];
  return user?.role === 'admin' && (perms.includes('*') || perms.includes('manage_orders'));
}

const roomsFor = (ticket) => [ROOMS.user(idOf(ticket.user)), ROOMS.supportAgents];

function messageView(m) {
  return { _id: m._id, sender: m.sender, senderName: m.senderName || null, text: m.text, createdAt: m.createdAt };
}

function ticketSummary(ticket, event) {
  return {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    event,
    user: idOf(ticket.user),
    lastMessageAt: ticket.lastMessageAt,
    lastMessageBy: ticket.lastMessageBy,
    updatedAt: ticket.updatedAt,
  };
}

function emitTicket(ticket, event) {
  emitToRooms(roomsFor(ticket), 'support:ticket', ticketSummary(ticket, event));
}

function emitMessage(ticket, message, clientId = null) {
  emitToRooms(roomsFor(ticket), 'support:message', {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    message: messageView(message),
    clientId: clientId || null,
  });
}

// The ticket `user` may act on: their own as the user, any as an agent. Throws 404 otherwise.
async function ticketFor(user, ticketId) {
  if (!ticketId || !OBJECT_ID.test(String(ticketId))) throw new ApiError(400, 'Invalid ticketId');
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  if (isAgent(user)) return { ticket, side: 'agent' };
  if (idOf(ticket.user) === String(user.id) && user.role !== 'admin') return { ticket, side: 'user' };
  throw new ApiError(404, 'Ticket not found');
}

// Adds a message from the user or an agent, saves, and pushes it. clientId (optional, from the
// app) comes back on the event so the sender can match its optimistic bubble.
async function postMessage({ ticket, side, senderName, text, clientId = null }) {
  const body = String(text ?? '').trim();
  if (!body) throw new ApiError(422, 'text is required');
  if (CLOSED.includes(ticket.status)) {
    throw new ApiError(400, side === 'user' ? 'This ticket has been closed. Reopen it to reply.' : 'This ticket is closed. Reopen it (status open) to reply.');
  }
  const sender = side === 'agent' ? 'agent' : 'user';
  ticket.messages.push({ sender, senderName: sender === 'agent' ? (senderName || 'Support executive') : senderName, text: body.slice(0, MAX_TEXT) });
  const message = ticket.messages[ticket.messages.length - 1];
  const now = new Date();
  ticket.lastMessageAt = now;
  ticket.lastMessageBy = sender;
  // Writing in the chat means you've read it.
  if (sender === 'user') {
    ticket.userReadAt = now;
    if (ticket.status === 'in_progress') ticket.status = 'open';
  } else {
    ticket.agentReadAt = now;
    ticket.adminReply = message.text;
    if (ticket.status === 'open') ticket.status = 'in_progress';
  }
  await ticket.save();
  emitMessage(ticket, message, clientId);

  // A push for the user too, for when the app isn't open.
  if (sender === 'agent') {
    notifyUser(ticket.user, {
      title: `Ticket ${ticket.ticketNumber || ''}`.trim(),
      body: message.text.length > 120 ? `${message.text.slice(0, 117)}...` : message.text,
      type: 'support_reply',
      data: { ticketId: ticket._id },
    }).catch((err) => logServerError('Support reply push failed', err));
  }
  return { ticket, message };
}

// Agent changes the status. Closing adds a system line to the conversation.
async function setStatus(ticket, status) {
  if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) throw new ApiError(422, 'Invalid status');
  if (ticket.status === status) return ticket;
  ticket.status = status;
  let line = null;
  if (CLOSED.includes(status)) {
    ticket.closedAt = new Date();
    ticket.messages.push({ sender: 'system', text: 'This ticket has been closed' });
    line = ticket.messages[ticket.messages.length - 1];
    ticket.lastMessageAt = new Date();
    ticket.lastMessageBy = 'system';
  }
  await ticket.save();
  if (line) emitMessage(ticket, line);
  emitTicket(ticket, 'status');
  return ticket;
}

// "I've read up to now" for one side; tells the other side (read receipts).
async function markRead(ticket, side) {
  const at = new Date();
  ticket[side === 'agent' ? 'agentReadAt' : 'userReadAt'] = at;
  await ticket.save();
  emitToRooms(roomsFor(ticket), 'support:read', { ticketId: ticket._id, by: side, at });
  return at;
}

function emitTyping(ticket, side, name, typing) {
  emitToRooms(roomsFor(ticket), 'support:typing', { ticketId: ticket._id, from: side, name: side === 'agent' ? 'Support' : (name || null), typing: !!typing });
}

// Unread for one side: messages from the other side after that side's read marker.
function unreadFor(ticket, side) {
  const other = side === 'user' ? 'agent' : 'user';
  const readAt = ticket[side === 'user' ? 'userReadAt' : 'agentReadAt'];
  const after = (m) => m.sender === other && (!readAt || new Date(m.createdAt) > new Date(readAt));
  if (Array.isArray(ticket.messages) && ticket.messages.length) return ticket.messages.filter(after).length;
  // Lists leave the messages out: whether the last message is from the other side and unread.
  return ticket.lastMessageBy === other && (!readAt || new Date(ticket.lastMessageAt) > new Date(readAt)) ? 1 : 0;
}

module.exports = {
  CLOSED,
  isAgent,
  ticketFor,
  postMessage,
  setStatus,
  markRead,
  emitTyping,
  emitTicket,
  emitMessage,
  unreadFor,
  messageView,
};
