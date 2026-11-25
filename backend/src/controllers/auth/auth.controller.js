const bcrypt = require('bcryptjs');
const { User, PickerProfile, DeliveryProfile, Wallet } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const otpService = require('../../services/otp.service');
const tokenService = require('../../services/token.service');
const { resolveOtpPhone } = require('../../utils/phone');

async function respondWithTokens(res, user, { deviceId, platform } = {}, statusCode = 200, message = 'Success') {
  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  const safeUser = user.toObject();
  delete safeUser.password;
  return new ApiResponse(statusCode, { accessToken, refreshToken, user: safeUser }, message).send(res);
}

// ---------- Admin: email + password ----------
// (Full/other admin accounts are still created by another admin via POST /admin/admins —
// vendor/vendorAuth.controller.js#register is the one public/self-service exception, for store-managers.)

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
// Takes { phone } — the 10-digit number only, +91 assumed (countryCode optional) — see
// utils/phone.js#resolveOtpPhone.

const sendOtp = catchAsync(async (req, res) => {
  const phone = resolveOtpPhone(req.body);
  const result = await otpService.sendOtp(phone);
  new ApiResponse(200, result, 'OTP sent successfully').send(res);
});

const resendOtp = catchAsync(async (req, res) => {
  const phone = resolveOtpPhone(req.body);
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
  const phone = resolveOtpPhone(req.body);
  const { role, name, deviceId, platform } = req.body;
  const otp = req.body.otp ?? req.body.code; // `otp` per the app contract; `code` kept as an alias

  if (!otp) throw new ApiError(400, 'otp is required');

  const result = await otpService.verifyOtp(phone, otp);
  if (!result.valid) {
    throw new ApiError(400, OTP_ERROR_MESSAGES[result.reason] || 'Invalid or expired OTP', [
      { reason: result.reason, attemptsLeft: result.attemptsLeft },
    ]);
  }

  const effectiveRole = role || 'customer';
  if (!['customer', 'picker', 'delivery'].includes(effectiveRole)) {
    throw new ApiError(400, 'role must be one of customer, picker, delivery');
  }

  // Accounts are per (phone, role): a rider or picker opening the customer app with the same number
  // gets (or creates) their customer account, not their delivery/picker one — which every
  // customer route would refuse with a 403.
  let user = await User.findOne({ phone, role: effectiveRole });
  let isNewUser = false;

  if (!user) {
    // Both picker and delivery partners can self-register here, same as a customer — but they
    // land in {Picker,Delivery}Profile.status='pending', just like an admin-created one. Neither
    // can actually work (accept jobs / get assigned pick-lists) until an admin approves them —
    // see PATCH /admin/delivery-partners/:id/status and admin/pickers.controller.js.
    // A delivery partner's vehicle and KYC are collected after signup, one app screen at a time
    // (/delivery/onboarding/* — see delivery/onboarding.controller.js). Vehicle details are still
    // accepted here for older clients that send them with the OTP.
    let vehicleType, vehicleNumber, licenseNumber;
    if (effectiveRole === 'delivery') {
      ({ vehicleType, vehicleNumber, licenseNumber } = req.body);
    }

    // A picker's KYC (ID proof type/number, address, emergency contact, and the actual document
    // photo) isn't collected here — the app's onboarding flow gathers it afterward in separate
    // steps (profile screen, then document upload) via PUT /auth/me and
    // PATCH /picker/kyc-upload — see picker.controller.js#updateProfile. Accepted here too, purely
    // for backward compatibility with a client that still wants to submit it all in one call.
    let idProofType, idProofNumber, address, emergencyContactName, emergencyContactPhone;
    if (effectiveRole === 'picker') {
      ({ idProofType, idProofNumber, address, emergencyContactName, emergencyContactPhone } = req.body);
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
    if (effectiveRole === 'picker') {
      await PickerProfile.create({
        user: user._id, idProofType, idProofNumber, address, emergencyContactName, emergencyContactPhone, status: 'pending',
      });
    }
  } else if (!user.isActive) {
    throw new ApiError(403, 'Your account has been disabled');
  }

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  const safeUser = user.toObject();
  delete safeUser.password;
  new ApiResponse(200, { accessToken, refreshToken, isNewUser, user: safeUser }, 'Login successful').send(res);
});

// ---------- Google Social Login ----------
// POST /auth/google
const googleLogin = catchAsync(async (req, res) => {
  let { idToken, email, name, profileImage, role = 'customer', deviceId, platform } = req.body;

  if (idToken) {
    try {
      const { OAuth2Client } = require('google-auth-library');
      const webClientId = '718221804618-f3aigaboc8js517b6vnmufp9orltg3m7.apps.googleusercontent.com';
      const googleClient = new OAuth2Client(webClientId);
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: webClientId,
      });
      const payload = ticket.getPayload();
      if (payload.email) email = payload.email;
      if (payload.name) name = payload.name;
      if (payload.picture) profileImage = payload.picture;
    } catch (googleErr) {
      try {
        const { getAuth } = require('firebase-admin/auth');
        const { firebaseApp } = require('../../config/firebase');
        if (firebaseApp) {
          const decoded = await getAuth(firebaseApp).verifyIdToken(idToken);
          if (decoded.email) email = decoded.email;
          if (decoded.name) name = decoded.name;
          if (decoded.picture) profileImage = decoded.picture;
        }
      } catch (err) {
        console.warn('Token verify error, proceeding with payload data:', err.message);
      }
    }
  }

  if (!email) throw new ApiError(400, 'Email is required for Google login');

  email = String(email).trim().toLowerCase();
  let user = await User.findOne({ email });
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    user = await User.create({
      name: name || 'Google User',
      email,
      role: role || 'customer',
      profileImage: profileImage || null,
      isVerified: true,
      isActive: true,
    });
    await Wallet.create({ user: user._id, balance: 0 });
  } else {
    if (!user.isActive) throw new ApiError(403, 'Your account has been disabled');
    if (profileImage) {
      user.profileImage = profileImage;
      await user.save();
    }
  }

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  const safeUser = user.toObject();
  delete safeUser.password;
  new ApiResponse(200, { accessToken, refreshToken, isNewUser, user: safeUser }, 'Google login successful').send(res);
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

// PUT /me  { name, email, gender, profileImage, dateOfBirth }
const updateMe = catchAsync(async (req, res) => {
  const { name, email, gender, profileImage, dateOfBirth } = req.body;
  if (gender !== undefined && gender !== null && !['male', 'female', 'other'].includes(gender)) {
    throw new ApiError(400, 'gender must be one of male, female, other');
  }
  let parsedDob;
  if (dateOfBirth !== undefined && dateOfBirth !== null) {
    parsedDob = new Date(dateOfBirth);
    if (Number.isNaN(parsedDob.getTime())) throw new ApiError(400, 'dateOfBirth must be a valid date');
  }
  if (name !== undefined) req.user.name = name;
  if (email !== undefined) req.user.email = email;
  if (gender !== undefined) req.user.gender = gender;
  if (profileImage !== undefined) req.user.profileImage = profileImage;
  if (dateOfBirth !== undefined) req.user.dateOfBirth = dateOfBirth === null ? null : parsedDob;
  await req.user.save();

  const safeUser = req.user.toObject();
  delete safeUser.password;
  new ApiResponse(200, safeUser, 'Profile updated').send(res);
});

// POST /auth/me/profile-image
const uploadProfileImage = catchAsync(async (req, res) => {
  const file = req.file || (req.files && (req.files.image?.[0] || req.files.file?.[0]));
  if (!file) throw new ApiError(400, 'Image file is required');
  const imageUrl = `/uploads/${file.filename}`;
  req.user.profileImage = imageUrl;
  await req.user.save();

  const safeUser = req.user.toObject();
  delete safeUser.password;
  new ApiResponse(200, { profileImage: imageUrl, user: safeUser }, 'Profile image updated successfully').send(res);
});

module.exports = { loginWithPassword, sendOtp, resendOtp, verifyOtp, googleLogin, refresh, logout, logoutAll, me, updateMe, uploadProfileImage };
