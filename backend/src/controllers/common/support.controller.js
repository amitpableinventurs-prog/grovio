const crypto = require('crypto');
const { SupportTicket, Order, PocketTransfer, IncentiveOffer } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const supportService = require('../../services/support.service');
const chat = require('../../services/supportChat.service');

// Help tickets for every app (customer, delivery partner, picker): pick a category / issue,
// optionally about an order, payout or offer, then chat with support until it's closed; rate the
// help, or reopen it. The chat is live over Socket.IO (services/supportChat.service.js): these REST
// endpoints push the same events as the socket ones, so either can be used to send.

// What each app offers under "Help". Keys are stored on the ticket; labels are for display.
const SUPPORT_CATEGORIES = {
  delivery: [
    {
      key: 'past_order', label: 'Past order related issues', needsOrder: true,
      issues: [
        { key: 'long_distance_return_pay', label: 'Long Distance Return Pay' },
        { key: 'order_pay_incorrect', label: 'Order pay is incorrect' },
        { key: 'distance_incorrect', label: 'Distance travelled is incorrect' },
        { key: 'customer_issue', label: 'Issue with the customer' },
        { key: 'cash_collected_incorrect', label: 'Cash collected is incorrect' },
      ],
    },
    {
      key: 'payments', label: 'Pocket & payouts',
      issues: [
        { key: 'withdrawal_failed', label: 'Withdrawal failed / not received' },
        { key: 'weekly_payout', label: 'Weekly payout not received' },
        { key: 'cash_deposit', label: 'Cash deposit not updated' },
        { key: 'deduction', label: 'Wrong deduction' },
      ],
    },
    {
      key: 'incentives', label: 'Incentives & offers',
      issues: [
        { key: 'incentive_not_received', label: 'Incentive not received' },
        { key: 'offer_condition', label: 'Offer condition applied wrongly' },
        { key: 'gig_incomplete', label: 'Gig marked incomplete wrongly' },
      ],
    },
    { key: 'account', label: 'Account & documents', issues: [{ key: 'bank_details', label: 'Change bank details' }, { key: 'documents', label: 'Documents / KYC' }, { key: 'other', label: 'Something else' }] },
  ],
  customer: [
    { key: 'order', label: 'Issue with an order', needsOrder: true, issues: [{ key: 'missing_item', label: 'Item missing' }, { key: 'wrong_item', label: 'Wrong / damaged item' }, { key: 'late', label: 'Order is late' }, { key: 'refund', label: 'Refund' }] },
    { key: 'payments', label: 'Payments & wallet', issues: [{ key: 'payment_failed', label: 'Payment failed but money deducted' }, { key: 'wallet', label: 'Wallet balance' }] },
    { key: 'account', label: 'Account', issues: [{ key: 'other', label: 'Something else' }] },
  ],
  picker: [
    { key: 'job', label: 'Issue with a pick job', needsOrder: true, issues: [{ key: 'stock', label: 'Stock / item issue' }, { key: 'handover', label: 'Handover to delivery partner' }] },
    { key: 'account', label: 'Account', issues: [{ key: 'other', label: 'Something else' }] },
  ],
};

const findCategory = (role, key) => (SUPPORT_CATEGORIES[role] || []).find((c) => c.key === key);

async function newTicketNumber() {
  for (let i = 0; i < 5; i += 1) {
    const n = String(100000000 + crypto.randomInt(900000000));
    if (!(await SupportTicket.exists({ ticketNumber: n }))) return n;
  }
  return String(Date.now()).slice(-10);
}

// The order must be one this user was part of.
function orderAccess(user) {
  if (user.role === 'customer') return { customer: user.id };
  if (user.role === 'delivery') return { delivery: user.id };
  if (user.role === 'picker') return { 'pickTasks.picker': user.id };
  return { _id: null };
}

// side: whose unread count to include ('user' for the apps, 'agent' for the admin panel).
function ticketView(tk, side = 'user') {
  const t = tk.toObject ? tk.toObject() : tk;
  return {
    ...t,
    title: t.subject,
    canReply: !['closed', 'resolved'].includes(t.status),
    canRate: ['closed', 'resolved'].includes(t.status) && !t.rating,
    canReopen: ['closed', 'resolved'].includes(t.status),
    unreadCount: chat.unreadFor(t, side),
  };
}

// GET /common/support/home -> the Support screen: "Call support" (number, hours, open now),
// "Chat with us" (typical reply time, my open tickets) and "FAQs" (topics with counts), in order.
const supportHome = catchAsync(async (req, res) => {
  new ApiResponse(200, await supportService.supportHome(req.user)).send(res);
});

// GET /common/support/faqs?topic=&q= -> FAQs for my app (one topic and/or a search), with topics
const listFaqs = catchAsync(async (req, res) => {
  new ApiResponse(200, await supportService.listFaqs(req.user.role, { topic: req.query.topic, q: req.query.q })).send(res);
});

// GET /common/support/categories -> categories and issues for my app
const listCategories = catchAsync(async (req, res) => {
  new ApiResponse(200, SUPPORT_CATEGORIES[req.user.role] || []).send(res);
});

// POST /common/support { category, subcategory, message, orderId?, transferId?, offerId? }
// (older clients: { subject, message })
const createTicket = catchAsync(async (req, res) => {
  const { category, subcategory, message, orderId, transferId, offerId } = req.body;
  if (!message || !String(message).trim()) throw new ApiError(422, 'Describe the issue in message');

  let subject = req.body.subject;
  if (category) {
    const cat = findCategory(req.user.role, category);
    if (!cat) throw new ApiError(422, 'Unknown category');
    const issue = cat.issues.find((i) => i.key === subcategory);
    if (!issue) throw new ApiError(422, 'Pick an issue from this category');
    if (cat.needsOrder && !orderId) throw new ApiError(422, 'Choose the order this is about');
    subject = subject || `${cat.label} - ${issue.label}`;
  }
  if (!subject) throw new ApiError(422, 'subject or category is required');

  if (orderId && !(await Order.exists({ _id: orderId, ...orderAccess(req.user) }))) throw new ApiError(404, 'Order not found');
  if (transferId && !(await PocketTransfer.exists({ _id: transferId, rider: req.user.id }))) throw new ApiError(404, 'Transaction not found');
  if (offerId && !(await IncentiveOffer.exists({ _id: offerId }))) throw new ApiError(404, 'Offer not found');

  const text = String(message).trim();
  const ticket = await SupportTicket.create({
    ticketNumber: await newTicketNumber(),
    user: req.user.id,
    category: category || null,
    subcategory: subcategory || null,
    subject,
    message: text,
    order: orderId || null,
    transfer: transferId || null,
    offer: offerId || null,
    messages: [{ sender: 'user', senderName: req.user.name, text }],
    lastMessageAt: new Date(),
    lastMessageBy: 'user',
    userReadAt: new Date(),
  });
  chat.emitTicket(ticket, 'created');
  chat.emitMessage(ticket, ticket.messages[0]);
  new ApiResponse(201, ticketView(ticket), 'Support ticket created').send(res);
});

const listMyTickets = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = { user: req.user.id };
  if (req.query.status) where.status = req.query.status;
  const [rows, count] = await Promise.all([
    SupportTicket.find(where).select('-messages').sort({ createdAt: -1 }).skip(offset).limit(limit),
    SupportTicket.countDocuments(where),
  ]);
  new ApiResponse(200, { items: rows.map((r) => ticketView(r)), meta: buildPageMeta({ page, limit, count }) }).send(res);
});

async function myTicket(req) {
  const ticket = await SupportTicket.findOne({ _id: req.params.id, user: req.user.id }).populate('order', 'orderNumber');
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  return ticket;
}

// GET /common/support/:id -> the conversation
const getTicket = catchAsync(async (req, res) => {
  new ApiResponse(200, ticketView(await myTicket(req))).send(res);
});

// POST /common/support/:id/messages { text, clientId? } — same as the socket's support:send
const addMessage = catchAsync(async (req, res) => {
  const ticket = await myTicket(req);
  await chat.postMessage({ ticket, side: 'user', senderName: req.user.name, text: req.body.text, clientId: req.body.clientId });
  new ApiResponse(201, ticketView(ticket), 'Message sent').send(res);
});

// POST /common/support/:id/read -> I've read the conversation (same as the socket's support:read)
const markRead = catchAsync(async (req, res) => {
  const ticket = await myTicket(req);
  const at = await chat.markRead(ticket, 'user');
  new ApiResponse(200, { ticketId: ticket._id, readAt: at, unreadCount: 0 }).send(res);
});

// POST /common/support/:id/rate { rating: 'up' | 'down' }
const rateTicket = catchAsync(async (req, res) => {
  const ticket = await myTicket(req);
  if (!['up', 'down'].includes(req.body.rating)) throw new ApiError(422, "rating must be 'up' or 'down'");
  if (!['closed', 'resolved'].includes(ticket.status)) throw new ApiError(400, 'You can rate a ticket once it is closed');
  ticket.rating = req.body.rating;
  ticket.ratedAt = new Date();
  await ticket.save();
  chat.emitTicket(ticket, 'rated');
  new ApiResponse(200, ticketView(ticket), 'Thanks for the feedback').send(res);
});

// POST /common/support/:id/reopen { text? } -> "Still have an issue? Reopen ticket"
const reopenTicket = catchAsync(async (req, res) => {
  const ticket = await myTicket(req);
  if (!['closed', 'resolved'].includes(ticket.status)) throw new ApiError(400, 'This ticket is still open');
  ticket.status = 'open';
  ticket.reopenedAt = new Date();
  ticket.closedAt = null;
  ticket.rating = null;
  ticket.ratedAt = null;
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  ticket.messages.push(text ? { sender: 'user', senderName: req.user.name, text } : { sender: 'system', text: 'Ticket reopened' });
  ticket.lastMessageAt = new Date();
  ticket.lastMessageBy = text ? 'user' : 'system';
  ticket.userReadAt = new Date();
  await ticket.save();
  chat.emitMessage(ticket, ticket.messages[ticket.messages.length - 1]);
  chat.emitTicket(ticket, 'reopened');
  new ApiResponse(200, ticketView(ticket), 'Ticket reopened').send(res);
});

// ---- Admin-only ----
const listAllTickets = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, category } = req.query;
  const where = {};
  if (status) where.status = status;
  if (category) where.category = category;

  const [rows, count] = await Promise.all([
    SupportTicket.find(where).select('-messages').populate('user', 'name phone role').populate('order', 'orderNumber').sort({ createdAt: -1 }).skip(offset).limit(limit),
    SupportTicket.countDocuments(where),
  ]);
  new ApiResponse(200, { items: rows.map((r) => ticketView(r, 'agent')), meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /admin/support-tickets/:id -> full conversation
const getTicketAdmin = catchAsync(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id).populate('user', 'name phone role').populate('order', 'orderNumber orderStatus');
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  new ApiResponse(200, ticketView(ticket, 'agent')).send(res);
});

// POST /admin/support-tickets/:id/read -> support has read it (the user sees a read receipt)
const markReadAdmin = catchAsync(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  const at = await chat.markRead(ticket, 'agent');
  new ApiResponse(200, { ticketId: ticket._id, readAt: at, unreadCount: 0 }).send(res);
});

// PATCH /admin/support-tickets/:id { adminReply, status } -> reply (added to the conversation)
// and/or change status. Closing it lets the user rate or reopen it. Reopening + reply in one go
// works: a non-closing status is applied before the reply, a closing one after it.
const replyToTicket = catchAsync(async (req, res) => {
  const { adminReply, status } = req.body;
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  const closing = chat.CLOSED.includes(status);
  const text = String(adminReply || '').trim();

  if (status !== undefined && status !== null && status !== '' && !closing) await chat.setStatus(ticket, status);
  if (text) await chat.postMessage({ ticket, side: 'agent', text });
  if (closing) await chat.setStatus(ticket, status);

  new ApiResponse(200, ticketView(ticket, 'agent'), 'Ticket updated').send(res);
});

module.exports = {
  SUPPORT_CATEGORIES,
  supportHome,
  listFaqs,
  listCategories,
  createTicket,
  listMyTickets,
  getTicket,
  addMessage,
  rateTicket,
  reopenTicket,
  markRead,
  markReadAdmin,
  listAllTickets,
  getTicketAdmin,
  replyToTicket,
};
