const { SupportTicket } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');

const createTicket = catchAsync(async (req, res) => {
  const { subject, message } = req.body;
  const ticket = await SupportTicket.create({ user: req.user.id, subject, message });
  new ApiResponse(201, ticket, 'Support ticket created').send(res);
});

const listMyTickets = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const [rows, count] = await Promise.all([
    SupportTicket.find({ user: req.user.id }).sort({ createdAt: -1 }).skip(offset).limit(limit),
    SupportTicket.countDocuments({ user: req.user.id }),
  ]);
  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// ---- Admin-only ----
const listAllTickets = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status } = req.query;
  const where = status ? { status } : {};

  const [rows, count] = await Promise.all([
    SupportTicket.find(where).sort({ createdAt: -1 }).skip(offset).limit(limit),
    SupportTicket.countDocuments(where),
  ]);
  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const replyToTicket = catchAsync(async (req, res) => {
  const { adminReply, status } = req.body;
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw new ApiError(404, 'Ticket not found');

  if (adminReply !== undefined) ticket.adminReply = adminReply;
  if (status !== undefined) ticket.status = status;
  await ticket.save();

  new ApiResponse(200, ticket, 'Ticket updated').send(res);
});

module.exports = { createTicket, listMyTickets, listAllTickets, replyToTicket };
