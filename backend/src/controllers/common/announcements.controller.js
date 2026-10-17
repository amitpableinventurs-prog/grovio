const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const announcements = require('../../services/announcement.service');

// Company notices in the apps' Updates tab (services/announcement.service.js) — any role.

// GET /common/announcements?category=
const list = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { items, count } = await announcements.listForUser(req.user, { category: req.query.category, offset, limit });
  new ApiResponse(200, { items, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /common/announcements/unread-count -> Updates tab badge
const unreadCount = catchAsync(async (req, res) => {
  new ApiResponse(200, await announcements.unreadCount(req.user)).send(res);
});

// GET /common/announcements/:id -> Details page (marks it read)
const detail = catchAsync(async (req, res) => {
  new ApiResponse(200, await announcements.detailForUser(req.user, req.params.id)).send(res);
});

// POST /common/announcements/:id/ack -> "Okay, I understand"
const acknowledge = catchAsync(async (req, res) => {
  new ApiResponse(200, await announcements.acknowledge(req.user, req.params.id), 'Thanks for confirming').send(res);
});

module.exports = { list, unreadCount, detail, acknowledge };
