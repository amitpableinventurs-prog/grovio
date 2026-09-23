// Picker app login/signup: phone number -> OTP -> tokens (the app's single "Login/Signup with
// Phone Number" screen, then the "Enter OTP" screen). Same OTP machinery as the generic
// /auth/send-otp + /auth/verify-otp (see auth.controller.js), but locked to role 'picker':
//  - a number already registered as a customer / delivery partner / admin is refused up front,
//    instead of silently logging that other account into the Picker app;
//  - the response carries the PickerProfile plus an `onboarding.nextStep` so the app knows
//    which screen to route to after login (profile -> KYC upload -> awaiting approval -> home).
// Token refresh, logout and PUT /auth/me are shared with every other role.
const { User, PickerProfile, Wallet } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const otpService = require('../../services/otp.service');
const tokenService = require('../../services/token.service');

const OTP_ERROR_MESSAGES = {
  not_found: 'No OTP was found for this number. Please request a new one.',
  expired: 'This OTP has expired. Please request a new one.',
  max_attempts: 'Too many incorrect attempts. Please request a new OTP.',
  invalid: 'Incorrect OTP. Please try again.',
};

// Default name given to an account created by OTP signup before the picker fills in the profile
// screen — same placeholder auth.controller.js#verifyOtp uses.
const PLACEHOLDER_NAME = 'User';

// Where the app should send the picker after login / on app launch:
//   blocked          — admin blocked this picker; show a "contact support" screen
//   home             — approved, can work
//   profile          — fill in name/email/gender/DOB via PUT /auth/me
//   kyc              — upload ID proof via PATCH /picker/profile
//   pending_approval — everything submitted, waiting on PATCH /admin/pickers/:id/status
// An approved picker always goes home, even if admin onboarding skipped a KYC document.
function pickerOnboarding(user, profile) {
  const profileComplete = !!user.name && user.name !== PLACEHOLDER_NAME;
  const kycComplete = !!(profile?.idProofType && profile?.idProofNumber && profile?.idProofDocument);

  let nextStep;
  if (profile?.status === 'blocked') nextStep = 'blocked';
  else if (profile?.status === 'approved') nextStep = 'home';
  else if (!profileComplete) nextStep = 'profile';
  else if (!kycComplete) nextStep = 'kyc';
  else nextStep = 'pending_approval';

  return { status: profile?.status || 'pending', profileComplete, kycComplete, nextStep };
}

// Rejects numbers that belong to a non-picker account or a disabled picker. Runs before an OTP
// is sent (so no SMS is wasted) and again before one is verified (so it's never consumed).
async function findPickerAccount(phone) {
  const user = await User.findOne({ phone });
  if (!user) return null;
  if (user.role !== 'picker') {
    throw new ApiError(409, 'This number is already registered with a different Grovio account. Please use another number for the Picker app.');
  }
  if (!user.isActive) throw new ApiError(403, 'Your account has been disabled. Please contact support.');
  return user;
}

// The Picker app sends the number exactly as typed on its login screen: `mobile` (digits only),
// with the country code fixed to +91 in the UI — `countryCode` is optional and defaults to that.
// Stored as the canonical "+919876543210" form, the same key every other role's account uses.
const DEFAULT_COUNTRY_CODE = '+91';
function resolvePickerPhone(body) {
  const mobile = String(body.mobile ?? '').trim();
  const digits = String(body.countryCode ?? DEFAULT_COUNTRY_CODE).replace(/\D/g, '');
  const cc = `+${digits}`;
  const validLength = cc === DEFAULT_COUNTRY_CODE ? /^\d{10}$/ : /^\d{6,14}$/;
  if (!digits || !validLength.test(mobile)) {
    throw new ApiError(400, cc === DEFAULT_COUNTRY_CODE ? 'Enter a valid 10-digit mobile number' : 'Enter a valid mobile number');
  }
  return `${cc}${mobile}`;
}

function safeUserOf(user) {
  const safeUser = user.toObject();
  delete safeUser.password;
  return safeUser;
}

// POST /auth/picker/send-otp  { mobile, countryCode? }
const sendOtp = catchAsync(async (req, res) => {
  const phone = resolvePickerPhone(req.body);
  const user = await findPickerAccount(phone);
  const result = await otpService.sendOtp(phone);
  new ApiResponse(200, { ...result, isRegistered: !!user }, 'OTP sent successfully').send(res);
});

// POST /auth/picker/resend-otp  — same body/behavior as send-otp; the server-side cooldown applies.
const resendOtp = catchAsync(async (req, res) => {
  const phone = resolvePickerPhone(req.body);
  const user = await findPickerAccount(phone);
  const result = await otpService.sendOtp(phone);
  new ApiResponse(200, { ...result, isRegistered: !!user }, 'OTP resent successfully').send(res);
});

// POST /auth/picker/verify-otp  { mobile, countryCode?, otp, deviceId?, platform?, name? }
// Logs an existing picker in, or creates a new picker account (PickerProfile status 'pending')
// on first verification.
const verifyOtp = catchAsync(async (req, res) => {
  const phone = resolvePickerPhone(req.body);
  const { otp, name, deviceId, platform } = req.body;

  let user = await findPickerAccount(phone);

  const result = await otpService.verifyOtp(phone, String(otp));
  if (!result.valid) {
    throw new ApiError(400, OTP_ERROR_MESSAGES[result.reason] || 'Invalid or expired OTP', [
      { reason: result.reason, attemptsLeft: result.attemptsLeft },
    ]);
  }

  let isNewUser = false;
  if (!user) {
    isNewUser = true;
    user = await User.create({ name: name?.trim() || PLACEHOLDER_NAME, phone, role: 'picker', isVerified: true });
    await Wallet.create({ user: user._id, balance: 0 });
  } else if (!user.isVerified) {
    user.isVerified = true;
    await user.save();
  }

  // Admin-created pickers already have a profile; this only fills the gap for a new signup (or
  // a legacy account that somehow never got one).
  let profile = await PickerProfile.findOne({ user: user._id });
  if (!profile) profile = await PickerProfile.create({ user: user._id, status: 'pending' });

  const { accessToken, refreshToken } = await tokenService.issueTokenPair(user, { deviceId, platform });
  new ApiResponse(200, {
    accessToken,
    refreshToken,
    isNewUser,
    user: safeUserOf(user),
    pickerProfile: profile,
    onboarding: pickerOnboarding(user, profile),
  }, isNewUser ? 'Signup successful' : 'Login successful').send(res);
});

// GET /auth/picker/me — for the app's splash screen: who am I and where should I land?
const me = catchAsync(async (req, res) => {
  const profile = await PickerProfile.findOne({ user: req.user._id });
  new ApiResponse(200, {
    user: safeUserOf(req.user),
    pickerProfile: profile,
    onboarding: pickerOnboarding(req.user, profile),
  }).send(res);
});

module.exports = { sendOtp, resendOtp, verifyOtp, me, pickerOnboarding };
