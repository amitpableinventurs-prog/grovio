const { ErrorLog } = require('../../models');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const catchAsync = require('../../utils/catchAsync');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { logAdminActivity } = require('../../services/audit.service');

// Admin > Error Logs: backend and app errors by date and time (services/errorLog.service.js).

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ?from=&to= (ISO date-times, on when it happened) &source=&app=&level=&search=
function filters(q, { withSource = true } = {}) {
  const where = {};
  if (withSource && q.source) where.source = q.source;
  if (q.app) where.app = q.app;
  if (q.level) where.level = q.level;
  if (q.from || q.to) {
    where.occurredAt = {};
    if (q.from) where.occurredAt.$gte = new Date(q.from);
    if (q.to) where.occurredAt.$lte = new Date(q.to);
  }
  if (q.search?.trim()) {
    const rx = new RegExp(escapeRegex(q.search.trim()), 'i');
    where.$or = [{ message: rx }, { url: rx }, { screen: rx }];
  }
  return where;
}

// GET /admin/error-logs — newest first (or ?sort=oldest), without stacks; summary = how many per
// source for the same filters.
const listErrorLogs = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = filters(req.query);
  const [rows, count, bySource] = await Promise.all([
    ErrorLog.find(where)
      .select('-stack -context')
      .populate('user', 'name phone')
      .sort({ occurredAt: req.query.sort === 'oldest' ? 1 : -1 })
      .skip(offset)
      .limit(limit),
    ErrorLog.countDocuments(where),
    ErrorLog.aggregate([{ $match: filters(req.query, { withSource: false }) }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
  ]);
  const summary = { backend: 0, mobile: 0, web: 0 };
  bySource.forEach((s) => { summary[s._id] = s.count; });
  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }), summary }).send(res);
});

// GET /admin/error-logs/:id — with stack trace and context.
const getErrorLog = catchAsync(async (req, res) => {
  const log = await ErrorLog.findById(req.params.id).populate('user', 'name phone email');
  if (!log) throw new ApiError(404, 'Error log not found');
  new ApiResponse(200, log).send(res);
});

const deleteErrorLog = catchAsync(async (req, res) => {
  const log = await ErrorLog.findByIdAndDelete(req.params.id);
  if (!log) throw new ApiError(404, 'Error log not found');
  new ApiResponse(200, null, 'Error log deleted').send(res);
});

// DELETE /admin/error-logs?<same filters as the list> — clears every matching log.
const clearErrorLogs = catchAsync(async (req, res) => {
  const where = filters(req.query);
  const { deletedCount } = await ErrorLog.deleteMany(where);
  await logAdminActivity({ adminId: req.user.id, action: 'error_logs.clear', entityType: 'ErrorLog', metadata: { filters: req.query, deleted: deletedCount } });
  new ApiResponse(200, { deleted: deletedCount }, `Deleted ${deletedCount} error logs`).send(res);
});

module.exports = { listErrorLogs, getErrorLog, deleteErrorLog, clearErrorLogs };
