const { AppAlert } = require('../../models');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const catchAsync = require('../../utils/catchAsync');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { logAdminActivity } = require('../../services/audit.service');
const { alertStatus, notifyApps } = require('../../services/appAlert.service');

// Admin > Alert Messages: alerts the Customer / Picker / Delivery apps show (services/appAlert.service.js).

const FIELDS = ['title', 'message', 'severity', 'display', 'apps', 'dismissible', 'cta', 'startsAt', 'endsAt', 'isActive'];
function pick(src) {
  const data = Object.fromEntries(FIELDS.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));
  if (data.cta === null) data.cta = { label: null, url: null }; // removes the button
  return data;
}
const adminView = (alert) => ({ ...alert.toObject(), status: alertStatus(alert) });

// GET /admin/alerts?status=live|scheduled|ended|off&app=
const listAlerts = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const now = new Date();
  const where = {};
  if (req.query.app) where.apps = req.query.app;
  switch (req.query.status) {
    case 'off': where.isActive = false; break;
    case 'scheduled': Object.assign(where, { isActive: true, startsAt: { $gt: now } }); break;
    case 'ended': Object.assign(where, { isActive: true, endsAt: { $lte: now } }); break;
    case 'live':
      Object.assign(where, {
        isActive: true,
        $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }],
      });
      break;
    default: break;
  }
  const [rows, count] = await Promise.all([
    AppAlert.find(where).populate('updatedBy', 'name').sort({ updatedAt: -1 }).skip(offset).limit(limit),
    AppAlert.countDocuments(where),
  ]);
  new ApiResponse(200, { items: rows.map(adminView), meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const createAlert = catchAsync(async (req, res) => {
  const alert = await AppAlert.create({ ...pick(req.body), createdBy: req.user.id, updatedBy: req.user.id });
  await logAdminActivity({ adminId: req.user.id, action: 'alerts.create', entityType: 'AppAlert', entityId: alert._id });
  notifyApps(alert.apps);
  new ApiResponse(201, adminView(alert), 'Alert created').send(res);
});

const getAlert = catchAsync(async (req, res) => {
  const alert = await AppAlert.findById(req.params.id).populate('createdBy updatedBy', 'name');
  if (!alert) throw new ApiError(404, 'Alert not found');
  new ApiResponse(200, adminView(alert)).send(res);
});

const updateAlert = catchAsync(async (req, res) => {
  const alert = await AppAlert.findById(req.params.id);
  if (!alert) throw new ApiError(404, 'Alert not found');
  const before = [...alert.apps];
  alert.set({ ...pick(req.body), updatedBy: req.user.id });
  await alert.save();
  await logAdminActivity({ adminId: req.user.id, action: 'alerts.update', entityType: 'AppAlert', entityId: alert._id });
  notifyApps([...before, ...alert.apps]);
  new ApiResponse(200, adminView(alert), 'Alert updated').send(res);
});

// PATCH /admin/alerts/:id/active { isActive } — the on/off switch.
const setAlertActive = catchAsync(async (req, res) => {
  const alert = await AppAlert.findById(req.params.id);
  if (!alert) throw new ApiError(404, 'Alert not found');
  alert.set({ isActive: req.body.isActive, updatedBy: req.user.id });
  await alert.save();
  await logAdminActivity({ adminId: req.user.id, action: alert.isActive ? 'alerts.on' : 'alerts.off', entityType: 'AppAlert', entityId: alert._id });
  notifyApps(alert.apps);
  new ApiResponse(200, adminView(alert), alert.isActive ? 'Alert switched on' : 'Alert switched off').send(res);
});

const deleteAlert = catchAsync(async (req, res) => {
  const alert = await AppAlert.findByIdAndDelete(req.params.id);
  if (!alert) throw new ApiError(404, 'Alert not found');
  await logAdminActivity({ adminId: req.user.id, action: 'alerts.delete', entityType: 'AppAlert', entityId: alert._id, metadata: { message: alert.message } });
  notifyApps(alert.apps);
  new ApiResponse(200, null, 'Alert deleted').send(res);
});

module.exports = { listAlerts, createAlert, getAlert, updateAlert, setAlertActive, deleteAlert };
