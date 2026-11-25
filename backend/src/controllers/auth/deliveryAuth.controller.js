// Delivery app login/signup: phone number -> OTP -> tokens. Same OTP machinery as the generic
// /auth/send-otp + /auth/verify-otp (see auth.controller.js), but locked to role 'delivery':
//  - only the number's delivery account is used; a customer/picker account on the same number is a
//    separate account (users are unique per phone + role) and is left alone;
//  - the response carries the DeliveryProfile plus `onboarding.nextStep`, so the app knows which
//    screen to open after login (vehicle -> PAN/Aadhaar -> address proof -> selfie -> bank ->
//    awaiting approval -> home; see utils/deliveryOnboarding.js and delivery/onboarding.controller.js).
// Token refresh (/auth/refresh) is shared with every other role; logout is delivery-specific because
// it also takes the partner offline.
const { User, DeliveryProfile, Wallet } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const otpService = require('../../services/otp.service');
const tokenService = require('../../services/token.service');
const { verifyGoogleIdToken } = require('../../services/googleAuth.service');
const { resolveOtpPhone } = require('../../utils/phone');
const { deliveryOnboarding } = require('../../utils/deliveryOnboarding');
const { PLACEHOLDER_NAME } = require('../../utils/pickerOnboarding');

const OTP_ERROR_MESSAGES = {
  not_found: 'No OTP was found for this number. Please request a new one.',
  expired: 'This OTP has expired. Please request a new one.',
  max_attempts: 'Too many incorrect attempts. Please request a new OTP.',
  invalid: 'Incorrect OTP. Please try again.',
};

// The number's delivery account, if any; rejects a disabled one. Runs before an OTP is sent (so no
// SMS is wasted) and again before one is verified (so it's never consumed).
async function findDeliveryAccount(phone) {
  const user = await User.findOne({ phone, role: 'delivery' });
  if (!user) return null;
  if (!user.isActive) throw new ApiError(403, 'Your account has been disabled. Please contact support.');
  return user;
}

function safeUserOf(user) {
  const safeUser = user.toObject();
  delete safeUser.password;
  return safeUser;
}

// POST /auth/delivery/send-otp  { phone, countryCode? }
const sendOtp = catchAsync(async (req, res) => {
  const phone = resolveOtpPhone(req.body);
  const user = await findDeliveryAccount(phone);
  const result = await otpService.sendOtp(phone);
  new ApiResponse(200, { ...result, isRegistered: !!user }, 'OTP sent successfully').send(res);
});

// POST /auth/delivery/resend-otp  — same body/behavior as send-otp; the server-side cooldown applies.
const resendOtp = catchAsync(async (req, res) => {
  const phone = resolveOtpPhone(req.body);
  const user = await findDeliveryAccount(phone);
  const result = await otpService.sendOtp(phone);
  new ApiResponse(200, { ...result, isRegistered: !!user }, 'OTP resent successfully').send(res);
});

// POST /auth/delivery/verify-otp  { phone, countryCode?, otp, deviceId?, platform?, name? }
// Logs an existing delivery partner in, or creates a new account (DeliveryProfile status
// 'pending') on first verification.
const verifyOtp = catchAsync(async (req, res) => {
  const phone = resolveOtpPhone(req.body);
  const { otp, name, deviceId, platform } = req.body;

  let user = await findDeliveryAccount(phone);

  const result = await otpService.verifyOtp(phone, String(otp));
  if (!result.valid) {
    throw new ApiError(400, OTP_ERROR_MESSAGES[result.reason] || 'Invalid or expired OTP', [
      { reason: result.reason, attemptsLeft: result.attemptsLeft },
    ]);
  }

  let isNewUser = false;
  if (!user) {
    isNewUser = true;
    user = await User.create({ name: name?.trim() || PLACEHOLDER_NAME, phone, role: 'delivery', isVerified: true });
    await Wallet.create({ user: user._id, balance: 0 });
  } else if (!user.isVerified) {
    user.isVerified = true;
    await user.save();
  }

  // Admin-created partners already have a profile; this only fills the gap for a new signup (or
  // a legacy account that somehow never got one).
  let profile = await DeliveryProfile.findOne({ user: user._id });
  if (!profile) profile = await DeliveryProfile.create({ user: user._id, status: 'pending' });

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  new ApiResponse(200, {
    accessToken,
    refreshToken,
    isNewUser,
    user: safeUserOf(user),
    deliveryProfile: profile,
    onboarding: deliveryOnboarding(profile),
  }, isNewUser ? 'Signup successful' : 'Login successful').send(res);
});

// POST /auth/delivery/google  { idToken, deviceId?, platform? }
// "Sign in with Google" for the Delivery app. Same result as verify-otp — logs the delivery in, or creates
// a new account (profile status 'pending') — and the same onboarding.nextStep routing. The account is
// matched by the *verified* Google email within role 'delivery'. A new Google account has no phone
// number, which is fine: it only identifies the OTP flow.
const googleLogin = catchAsync(async (req, res) => {
  const { idToken, deviceId, platform } = req.body;
  const google = await verifyGoogleIdToken(idToken);

  let user = await User.findOne({ email: google.email, role: 'delivery' });
  let isNewUser = false;
  if (user) {
    if (!user.isActive) throw new ApiError(403, 'Your account has been disabled. Please contact support.');
    if (!user.isVerified) { user.isVerified = true; await user.save(); }
  } else {
    // Emails are unique across all roles, so an address already used by e.g. a customer account can't be reused here.
    if (await User.exists({ email: google.email })) {
      throw new ApiError(409, 'This email is already used by another account. Sign in with your phone number instead.');
    }
    isNewUser = true;
    user = await User.create({
      name: google.name || PLACEHOLDER_NAME, email: google.email, role: 'delivery',
      profileImage: google.picture, isVerified: true,
    });
    await Wallet.create({ user: user._id, balance: 0 });
  }

  let profile = await DeliveryProfile.findOne({ user: user._id });
  if (!profile) profile = await DeliveryProfile.create({ user: user._id, status: 'pending' });

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  new ApiResponse(200, {
    accessToken,
    refreshToken,
    isNewUser,
    user: safeUserOf(user),
    deliveryProfile: profile,
    onboarding: deliveryOnboarding(profile),
  }, isNewUser ? 'Signup successful' : 'Login successful').send(res);
});

// GET /auth/delivery/me — for the app's splash screen: who am I and where should I land?
const me = catchAsync(async (req, res) => {
  const profile = await DeliveryProfile.findOne({ user: req.user._id });
  new ApiResponse(200, {
    user: safeUserOf(req.user),
    deliveryProfile: profile,
    onboarding: deliveryOnboarding(profile),
  }).send(res);
});

// A logged-out partner can't take jobs, so take them offline (otherwise assignment could keep
// routing orders to a phone nobody is signed in on) and drop the push token.
async function takeDeliveryOffline(user) {
  await DeliveryProfile.updateOne({ user: user._id }, { isAvailable: false });
  if (user.fcmToken) {
    user.fcmToken = null;
    await user.save();
  }
}

// POST /auth/delivery/logout  { refreshToken } — signs out this device only.
const logout = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  const revoked = await tokenService.revokeRefreshToken(refreshToken, req.user._id);
  if (!revoked) throw new ApiError(400, 'Invalid or already-revoked refresh token');
  await takeDeliveryOffline(req.user);
  new ApiResponse(200, null, 'Logged out').send(res);
});

// POST /auth/delivery/logout-all — signs out every device this partner is logged in on.
const logoutAll = catchAsync(async (req, res) => {
  await tokenService.revokeAllForUser(req.user._id);
  await takeDeliveryOffline(req.user);
  new ApiResponse(200, null, 'Logged out from all devices').send(res);
});

module.exports = { sendOtp, resendOtp, verifyOtp, googleLogin, me, logout, logoutAll };
