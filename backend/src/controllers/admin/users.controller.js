const { User, Vendor, PickerProfile, DeliveryProfile } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const { notifyUser } = require('../../services/notification.service');
const { logAdminActivity } = require('../../services/audit.service');

const PROFILE_MODEL = {
  vendor: Vendor,
  picker: PickerProfile,
  delivery: DeliveryProfile,
};

// GET /admin/vendors | /admin/pickers | /admin/delivery-partners | /admin/customers
function listByRole(role) {
  return catchAsync(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const { status, search } = req.query;

    const where = { role };
    if (search) {
      where.$or = [{ name: new RegExp(search, 'i') }, { phone: new RegExp(search, 'i') }];
    }

    const ProfileModel = PROFILE_MODEL[role];
    if (status && ProfileModel) {
      const matchingProfiles = await ProfileModel.find({ status }).select('user');
      where._id = { $in: matchingProfiles.map((p) => p.user) };
    }

    const [rows, count] = await Promise.all([
      User.find(where).sort({ createdAt: -1 }).skip(offset).limit(limit),
      User.countDocuments(where),
    ]);

    let items = rows;
    if (ProfileModel) {
      const profiles = await ProfileModel.find({ user: { $in: rows.map((u) => u._id) } });
      const profileMap = new Map(profiles.map((p) => [p.user.toString(), p]));
      items = rows.map((u) => ({ ...u.toObject(), [`${role}Profile`]: profileMap.get(u._id.toString()) || null }));
    }

    new ApiResponse(200, { items, meta: buildPageMeta({ page, limit, count }) }).send(res);
  });
}

// PATCH /admin/vendors/:id/status  { status: 'approved' | 'rejected' | 'blocked' }
function updateProfileStatus(role) {
  return catchAsync(async (req, res) => {
    const { status } = req.body;
    const ProfileModel = PROFILE_MODEL[role];
    const validStatuses = role === 'vendor' ? ['pending', 'approved', 'rejected', 'blocked'] : ['pending', 'approved', 'blocked'];

    if (!validStatuses.includes(status)) {
      throw new ApiError(400, `Status must be one of: ${validStatuses.join(', ')}`);
    }

    const profile = await ProfileModel.findOne({ user: req.params.id });
    if (!profile) throw new ApiError(404, `${role} profile not found`);

    profile.status = status;
    await profile.save();

    await notifyUser(req.params.id, {
      title: 'Account status updated',
      body: `Your ${role} account status is now: ${status}`,
      type: 'account_status',
    });

    await logAdminActivity({
      adminId: req.user.id,
      action: `${role}.status_update`,
      entityType: role,
      entityId: profile._id,
      metadata: { status },
    });

    new ApiResponse(200, profile, 'Status updated').send(res);
  });
}

// PATCH /admin/pickers/:id/assign-store  { storeId }
const assignPickerToStore = catchAsync(async (req, res) => {
  const { storeId } = req.body;
  const profile = await PickerProfile.findOne({ user: req.params.id });
  if (!profile) throw new ApiError(404, 'Picker profile not found');

  profile.store = storeId || null;
  await profile.save();

  await logAdminActivity({
    adminId: req.user.id,
    action: 'picker.assign_store',
    entityType: 'PickerProfile',
    entityId: profile._id,
    metadata: { storeId },
  });

  new ApiResponse(200, profile, 'Picker linked to store').send(res);
});

// PATCH /admin/users/:id/active  { isActive: boolean }
const toggleActive = catchAsync(async (req, res) => {
  const { isActive } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');

  user.isActive = !!isActive;
  await user.save();

  await logAdminActivity({
    adminId: req.user.id,
    action: 'user.toggle_active',
    entityType: 'User',
    entityId: user._id,
    metadata: { isActive: user.isActive },
  });

  new ApiResponse(200, user, `User ${isActive ? 'activated' : 'blocked'}`).send(res);
});

const getUserDetail = catchAsync(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'User not found');

  const [vendorProfile, pickerProfile, deliveryProfile] = await Promise.all([
    Vendor.findOne({ user: user._id }),
    PickerProfile.findOne({ user: user._id }),
    DeliveryProfile.findOne({ user: user._id }),
  ]);

  new ApiResponse(200, { ...user.toObject(), vendorProfile, pickerProfile, deliveryProfile }).send(res);
});

module.exports = { listByRole, updateProfileStatus, assignPickerToStore, toggleActive, getUserDetail };
