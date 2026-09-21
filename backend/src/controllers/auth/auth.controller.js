const bcrypt = require('bcryptjs');
const { User, PickerProfile, DeliveryProfile, Wallet, Store } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const otpService = require('../../services/otp.service');
const tokenService = require('../../services/token.service');
const { resolvePhone } = require('../../utils/phone');
const { PERMISSIONS } = require('../../utils/permissions');

async function respondWithTokens(res, user, { deviceId, platform } = {}, statusCode = 200, message = 'Success') {
  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  const safeUser = user.toObject();
  delete safeUser.password;
  return new ApiResponse(statusCode, { accessToken, refreshToken, user: safeUser }, message).send(res);
}

// ---------- Vendor (store-manager) self-registration ----------
// Public signup, as an alternative to an admin manually creating one via POST /admin/admins.
// Produces the exact same kind of account (role: 'admin', MANAGE_OWN_STORE_INVENTORY permission,
// assignedStore) — just self-initiated. The store starts status: 'inactive', so it never shows up
// to customers (see customer/catalog.controller.js) until an admin reviews and activates it via
// PATCH /admin/stores/:id — THAT is the actual approval gate, not the account's permissions.
const registerVendor = catchAsync(async (req, res) => {
  const { name, email, password, phone, storeName, address, lat, lng, deviceId, platform } = req.body;

  const existingEmail = await User.findOne({ email });
  if (existingEmail) throw new ApiError(409, 'Email already registered');

  if (phone) {
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) throw new ApiError(409, 'Phone number already registered');
  }

  const store = await Store.create({
    name: storeName,
    address: address || null,
    lat: lat ?? null,
    lng: lng ?? null,
    status: 'inactive',
  });

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email,
    phone: phone || undefined,
    password: hashed,
    role: 'admin',
    permissions: [PERMISSIONS.MANAGE_OWN_STORE_INVENTORY],
    assignedStore: store._id,
    isVerified: true,
  });

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  const safeUser = user.toObject();
  delete safeUser.password;

  new ApiResponse(201, { accessToken, refreshToken, user: safeUser, store }, 'Vendor registered successfully. Your store is pending admin approval.').send(res);
});

// ---------- Admin: email + password ----------
// (Full/other admin accounts are still created by another admin via POST /admin/admins —
// registerVendor above is the one public/self-service exception, for store-managers.)

const loginWithPassword = catchAsync(async (req, res) => {
  const { email, password, deviceId, platform } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user || !user.password) throw new ApiError(401, 'Invalid email or password');

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new ApiError(401, 'Invalid email or password');

  if (!user.isActive) throw new ApiError(403, 'Your account has been disabled');

  await respondWithTokens(res, user, { deviceId, platform }, 200, 'Login successful');
});

// ---------- Customer / Picker / Delivery: mobile + OTP ----------
// Accepts either { countryCode, mobile } (what the Flutter apps send) or a
// single combined { phone } (handy for Swagger/Postman testing) — see utils/phone.js.

const sendOtp = catchAsync(async (req, res) => {
  const phone = resolvePhone(req.body);
  const result = await otpService.sendOtp(phone);
  new ApiResponse(200, result, 'OTP sent successfully').send(res);
});

const resendOtp = catchAsync(async (req, res) => {
  const phone = resolvePhone(req.body);
  const result = await otpService.sendOtp(phone);
  new ApiResponse(200, result, 'OTP resent successfully').send(res);
});

const OTP_ERROR_MESSAGES = {
  not_found: 'No OTP was found for this number. Please request a new one.',
  expired: 'This OTP has expired. Please request a new one.',
  max_attempts: 'Too many incorrect attempts. Please request a new OTP.',
  invalid: 'Incorrect OTP. Please try again.',
};

const verifyOtp = catchAsync(async (req, res) => {
  const phone = resolvePhone(req.body);
  const { role, name, deviceId, platform } = req.body;
  const otp = req.body.otp ?? req.body.code; // `otp` per the app contract; `code` kept as an alias

  if (!otp) throw new ApiError(400, 'otp is required');

  const result = await otpService.verifyOtp(phone, otp);
  if (!result.valid) {
    throw new ApiError(400, OTP_ERROR_MESSAGES[result.reason] || 'Invalid or expired OTP', [
      { reason: result.reason, attemptsLeft: result.attemptsLeft },
    ]);
  }

  let user = await User.findOne({ phone });
  let isNewUser = false;

  if (!user) {
    const effectiveRole = role || 'customer';
    if (!['customer', 'picker', 'delivery'].includes(effectiveRole)) {
      throw new ApiError(400, 'role must be one of customer, picker, delivery');
    }
    // Picker accounts still require Admin onboarding (see admin/pickers.controller.js) — the
    // KYC step (ID proof upload, employee ID, shift, etc.) has no self-service equivalent.
    // Delivery partners CAN self-register here, but land in DeliveryProfile.status='pending'
    // just like an admin-created one — they still can't accept jobs until an admin approves
    // them via PATCH /admin/delivery-partners/:id/status.
    if (effectiveRole === 'picker') {
      throw new ApiError(404, 'No account found for this number. Please contact your admin.');
    }

    let vehicleType, vehicleNumber, licenseNumber;
    if (effectiveRole === 'delivery') {
      ({ vehicleType, vehicleNumber, licenseNumber } = req.body);
      if (!vehicleType || !vehicleNumber || !licenseNumber) {
        throw new ApiError(400, 'vehicleType, vehicleNumber and licenseNumber are required to register as a delivery partner');
      }
    }

    isNewUser = true;
    user = await User.create({
      name: name || 'User',
      phone,
      role: effectiveRole,
      isVerified: true,
    });
    await Wallet.create({ user: user._id, balance: 0 });

    if (effectiveRole === 'delivery') {
      await DeliveryProfile.create({ user: user._id, vehicleType, vehicleNumber, licenseNumber, status: 'pending' });
    }
  } else if (!user.isActive) {
    throw new ApiError(403, 'Your account has been disabled');
  }

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  const safeUser = user.toObject();
  delete safeUser.password;
  new ApiResponse(200, { accessToken, refreshToken, isNewUser, user: safeUser }, 'Login successful').send(res);
});

// ---------- Token refresh / session management ----------

// POST /auth/refresh  { refreshToken }
const refresh = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new ApiError(400, 'refreshToken is required');

  const tokenDoc = await tokenService.findValidRefreshToken(refreshToken);
  if (!tokenDoc) throw new ApiError(401, 'Invalid or expired refresh token');

  const user = await User.findById(tokenDoc.user);
  if (!user || !user.isActive) throw new ApiError(401, 'Account no longer available');

  const { accessToken, refreshToken: newRefreshToken } = await tokenService.rotateRefreshToken(tokenDoc, user);
  new ApiResponse(200, { accessToken, refreshToken: newRefreshToken }, 'Token refreshed').send(res);
});

// POST /auth/logout  { refreshToken }
const logout = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) await tokenService.revokeRefreshToken(refreshToken);
  new ApiResponse(200, null, 'Logged out').send(res);
});

// POST /auth/logout-all
const logoutAll = catchAsync(async (req, res) => {
  await tokenService.revokeAllForUser(req.user.id);
  new ApiResponse(200, null, 'Logged out from all sessions').send(res);
});

// ---------- Profile ----------

const me = catchAsync(async (req, res) => {
  const safeUser = req.user.toObject();
  delete safeUser.password;
  new ApiResponse(200, safeUser).send(res);
});

// PUT /me  { name, email, gender, profileImage }
const updateMe = catchAsync(async (req, res) => {
  const { name, email, gender, profileImage } = req.body;
  if (gender !== undefined && gender !== null && !['male', 'female', 'other'].includes(gender)) {
    throw new ApiError(400, 'gender must be one of male, female, other');
  }
  if (name !== undefined) req.user.name = name;
  if (email !== undefined) req.user.email = email;
  if (gender !== undefined) req.user.gender = gender;
  if (profileImage !== undefined) req.user.profileImage = profileImage;
  await req.user.save();

  const safeUser = req.user.toObject();
  delete safeUser.password;
  new ApiResponse(200, safeUser, 'Profile updated').send(res);
});

module.exports = { registerVendor, loginWithPassword, sendOtp, resendOtp, verifyOtp, refresh, logout, logoutAll, me, updateMe };
