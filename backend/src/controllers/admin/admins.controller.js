const bcrypt = require('bcryptjs');
const { User, AdminActivityLog } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { ALL_PERMISSIONS } = require('../../utils/permissions');
const { logAdminActivity } = require('../../services/audit.service');

// POST /admin/admins  { name, email, password, permissions: [...] }  -> create a staff admin
const createAdmin = catchAsync(async (req, res) => {
  const { name, email, password, permissions = [] } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw new ApiError(409, 'Email already registered');

  const invalid = permissions.filter((p) => p !== '*' && !ALL_PERMISSIONS.includes(p));
  if (invalid.length) throw new ApiError(400, `Unknown permissions: ${invalid.join(', ')}`);

  const hashed = await bcrypt.hash(password, 10);
  const admin = await User.create({ name, email, password: hashed, role: 'admin', permissions, isVerified: true });

  await logAdminActivity({
    adminId: req.user.id,
    action: 'admin.create',
    entityType: 'User',
    entityId: admin._id,
    metadata: { email, permissions },
  });

  const safeAdmin = admin.toObject();
  delete safeAdmin.password;
  new ApiResponse(201, safeAdmin, 'Admin created').send(res);
});

const listAdmins = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = { role: 'admin' };

  const [rows, count] = await Promise.all([
    User.find(where).sort({ createdAt: -1 }).skip(offset).limit(limit),
    User.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

// PATCH /admin/admins/:id/permissions  { permissions: [...] }
const updatePermissions = catchAsync(async (req, res) => {
  const { permissions } = req.body;
  const invalid = (permissions || []).filter((p) => p !== '*' && !ALL_PERMISSIONS.includes(p));
  if (invalid.length) throw new ApiError(400, `Unknown permissions: ${invalid.join(', ')}`);

  const admin = await User.findOne({ _id: req.params.id, role: 'admin' });
  if (!admin) throw new ApiError(404, 'Admin not found');

  admin.permissions = permissions || [];
  await admin.save();

  await logAdminActivity({
    adminId: req.user.id,
    action: 'admin.update_permissions',
    entityType: 'User',
    entityId: admin._id,
    metadata: { permissions: admin.permissions },
  });

  new ApiResponse(200, admin, 'Permissions updated').send(res);
});

// GET /admin/activity-logs?adminId=&action=
const listActivityLogs = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { adminId, action } = req.query;

  const where = {};
  if (adminId) where.admin = adminId;
  if (action) where.action = action;

  const [rows, count] = await Promise.all([
    AdminActivityLog.find(where).populate('admin', 'name email').sort({ createdAt: -1 }).skip(offset).limit(limit),
    AdminActivityLog.countDocuments(where),
  ]);

  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

module.exports = { createAdmin, listAdmins, updatePermissions, listActivityLogs };
