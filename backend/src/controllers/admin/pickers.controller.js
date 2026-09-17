const { User, PickerProfile, Wallet } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { resolvePhone } = require('../../utils/phone');
const { logAdminActivity } = require('../../services/audit.service');

// POST /admin/pickers — Admin-only onboarding. Pickers never self-register; they log in
// via OTP to the account created here (see auth.controller.js#verifyOtp).
const createPicker = catchAsync(async (req, res) => {
  const {
    name,
    email,
    address,
    idProofType,
    idProofNumber,
    emergencyContactName,
    emergencyContactPhone,
    employeeId,
    joiningDate,
    assignedStore,
    shift,
  } = req.body;

  const phone = resolvePhone(req.body);

  const existing = await User.findOne({ phone });
  if (existing) throw new ApiError(409, 'A user with this mobile number already exists');

  if (employeeId) {
    const existingEmployee = await PickerProfile.findOne({ employeeId });
    if (existingEmployee) throw new ApiError(409, 'Employee ID already in use');
  }

  const profileImage = req.files?.profilePhoto?.[0] ? `/uploads/${req.files.profilePhoto[0].filename}` : null;
  const idProofDocument = req.files?.idProofDocument?.[0] ? `/uploads/${req.files.idProofDocument[0].filename}` : null;

  const user = await User.create({
    name,
    email: email || undefined,
    phone,
    role: 'picker',
    profileImage,
    isVerified: true,
  });

  const profile = await PickerProfile.create({
    user: user._id,
    store: assignedStore || null,
    status: 'approved', // admin has already vetted this picker at creation time
    employeeId: employeeId || undefined,
    address,
    idProofType,
    idProofNumber,
    idProofDocument,
    emergencyContactName,
    emergencyContactPhone,
    joiningDate: joiningDate || null,
    shift,
  });

  await Wallet.create({ user: user._id, balance: 0 });

  await logAdminActivity({
    adminId: req.user.id,
    action: 'picker.create',
    entityType: 'PickerProfile',
    entityId: profile._id,
    metadata: { phone, employeeId, assignedStore },
  });

  new ApiResponse(201, { user, pickerProfile: profile }, 'Picker created').send(res);
});

// PUT /admin/pickers/:id — full edit of an existing picker's profile
const updatePicker = catchAsync(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'picker' });
  if (!user) throw new ApiError(404, 'Picker not found');

  const profile = await PickerProfile.findOne({ user: user._id });
  if (!profile) throw new ApiError(404, 'Picker profile not found');

  const { name, email } = req.body;
  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (req.files?.profilePhoto?.[0]) user.profileImage = `/uploads/${req.files.profilePhoto[0].filename}`;
  await user.save();

  const profileFields = [
    'address',
    'idProofType',
    'idProofNumber',
    'emergencyContactName',
    'emergencyContactPhone',
    'employeeId',
    'joiningDate',
    'shift',
  ];
  profileFields.forEach((f) => {
    if (req.body[f] !== undefined) profile[f] = req.body[f];
  });
  if (req.body.assignedStore !== undefined) profile.store = req.body.assignedStore || null;
  if (req.files?.idProofDocument?.[0]) profile.idProofDocument = `/uploads/${req.files.idProofDocument[0].filename}`;
  await profile.save();

  await logAdminActivity({
    adminId: req.user.id,
    action: 'picker.update',
    entityType: 'PickerProfile',
    entityId: profile._id,
    metadata: req.body,
  });

  new ApiResponse(200, { user, pickerProfile: profile }, 'Picker updated').send(res);
});

module.exports = { createPicker, updatePicker };
