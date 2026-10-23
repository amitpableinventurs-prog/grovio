const catchAsync = require('../../utils/catchAsync');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { logAdminActivity } = require('../../services/audit.service');
const sos = require('../../services/sos.service');

// SOS alerts from pickers, delivery partners and customers — see services/sos.service.js. Store
// managers see only their own store's alerts.

// GET /admin/sos?status=active|open|acknowledged|resolved|cancelled&role= -> newest first
const list = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { items, count, activeCount } = await sos.adminList(req.user, { status: req.query.status, role: req.query.role, offset, limit });
  new ApiResponse(200, { items, activeCount, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// GET /admin/sos/:id -> one alert with its location trail
const get = catchAsync(async (req, res) => {
  new ApiResponse(200, await sos.adminGet(req.user, req.params.id)).send(res);
});

// POST /admin/sos/:id/acknowledge -> "we're on it" (the person's app is told)
const acknowledge = catchAsync(async (req, res) => {
  const alert = await sos.acknowledge(req.user, req.params.id);
  await logAdminActivity({ adminId: req.user.id, action: 'sos.acknowledge', entityType: 'SosAlert', entityId: alert._id });
  new ApiResponse(200, alert, 'SOS acknowledged').send(res);
});

// POST /admin/sos/:id/resolve { note } -> closed, with what was done
const resolve = catchAsync(async (req, res) => {
  const alert = await sos.resolve(req.user, req.params.id, req.body || {});
  await logAdminActivity({ adminId: req.user.id, action: 'sos.resolve', entityType: 'SosAlert', entityId: alert._id, metadata: { note: alert.resolutionNote } });
  new ApiResponse(200, alert, 'SOS resolved').send(res);
});

module.exports = { list, get, acknowledge, resolve };
