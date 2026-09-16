const bcrypt = require('bcryptjs');
const { User, Vendor, Store, PickerProfile, DeliveryProfile, Wallet } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const otpService = require('../../services/otp.service');
const tokenService = require('../../services/token.service');
const { resolvePhone } = require('../../utils/phone');

async function respondWithTokens(res, user, { deviceId, platform } = {}, statusCode = 200, message = 'Success') {
  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  const safeUser = user.toObject();
  delete safeUser.password;
  return new ApiResponse(statusCode, { accessToken, refreshToken, user: safeUser }, message).send(res);
}

// ---------- Admin / Vendor: email + password ----------

const registerVendor = catchAsync(async (req, res) => {
  const { name, email, phone, password, storeName, address, lat, lng, deviceId, platform } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw new ApiError(409, 'Email already registered');

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, phone, password: hashed, role: 'vendor', isVerified: true });

  const vendor = await Vendor.create({
    user: user._id,
    businessName: storeName,
    commissionPercent: Number(process.env.DEFAULT_COMMISSION_PERCENT || 10),
  });

  await Store.create({ vendor: vendor._id, name: storeName, address, lat, lng });
  await Wallet.create({ user: user._id, balance: 0 });

  await respondWithTokens(res, user, { deviceId, platform }, 201, 'Vendor registered successfully. Awaiting admin approval.');
});

const loginWithPassword = catchAsync(async (req, res) => {
  const { email, password, deviceId, platform } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user || !user.password) throw new ApiError(401, 'Invalid email or password');

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new ApiError(401, 'Invalid email or password');

  if (!user.isActive) throw new ApiError(403, 'Your account has been disabled');

  if (user.role === 'vendor') {
    const vendor = await Vendor.findOne({ user: user._id });
    if (vendor && vendor.status !== 'approved') {
      throw new ApiError(403, `Your vendor account is ${vendor.status}. Please wait for admin approval.`);
    }
  }

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
    isNewUser = true;
    const effectiveRole = role || 'customer';
    if (!['customer', 'picker', 'delivery'].includes(effectiveRole)) {
      throw new ApiError(400, 'role must be one of customer, picker, delivery');
    }
    user = await User.create({
      name: name || 'User',
      phone,
      role: effectiveRole,
      isVerified: true,
    });

    if (effectiveRole === 'picker') await PickerProfile.create({ user: user._id });
    if (effectiveRole === 'delivery') await DeliveryProfile.create({ user: user._id });
    await Wallet.create({ user: user._id, balance: 0 });
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
