// Picker app login/signup: phone number -> OTP -> tokens (the app's single "Login/Signup with
// Phone Number" screen, then the "Enter OTP" screen). Same OTP machinery as the generic
// /auth/send-otp + /auth/verify-otp (see auth.controller.js), but locked to role 'picker':
//  - a number already registered as a customer / delivery partner / admin is refused up front,
//    instead of silently logging that other account into the Picker app;
//  - the response carries the PickerProfile plus an `onboarding.nextStep` so the app knows
//    which screen to route to after login (profile -> KYC upload -> awaiting approval -> home).
// Token refresh (/auth/refresh) is shared with every other role; the Register step and logout have
// picker-specific endpoints below (stricter validation, and logout also takes the picker offline).
const { User, PickerProfile, Wallet } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const otpService = require('../../services/otp.service');
const tokenService = require('../../services/token.service');
const { resolveMobile } = require('../../utils/phone');
const { pickerOnboarding, PLACEHOLDER_NAME } = require('../../utils/pickerOnboarding');

const OTP_ERROR_MESSAGES = {
  not_found: 'No OTP was found for this number. Please request a new one.',
  expired: 'This OTP has expired. Please request a new one.',
  max_attempts: 'Too many incorrect attempts. Please request a new OTP.',
  invalid: 'Incorrect OTP. Please try again.',
};

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

function safeUserOf(user) {
  const safeUser = user.toObject();
  delete safeUser.password;
  return safeUser;
}

// POST /auth/picker/send-otp  { mobile, countryCode? }
const sendOtp = catchAsync(async (req, res) => {
  const phone = resolveMobile(req.body);
  const user = await findPickerAccount(phone);
  const result = await otpService.sendOtp(phone);
  new ApiResponse(200, { ...result, isRegistered: !!user }, 'OTP sent successfully').send(res);
});

// POST /auth/picker/resend-otp  — same body/behavior as send-otp; the server-side cooldown applies.
const resendOtp = catchAsync(async (req, res) => {
  const phone = resolveMobile(req.body);
  const user = await findPickerAccount(phone);
  const result = await otpService.sendOtp(phone);
  new ApiResponse(200, { ...result, isRegistered: !!user }, 'OTP resent successfully').send(res);
});

// POST /auth/picker/verify-otp  { mobile, countryCode?, otp, deviceId?, platform?, name? }
// Logs an existing picker in, or creates a new picker account (PickerProfile status 'pending')
// on first verification.
const verifyOtp = catchAsync(async (req, res) => {
  const phone = resolveMobile(req.body);
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

const MIN_PICKER_AGE = 18;

// The app's date picker shows DD/MM/YYYY, so that's the primary format; ISO YYYY-MM-DD is also
// accepted. Rejects impossible dates (31/02/2000), future dates and pickers under 18.
// Returns a Date at UTC midnight so the stored day never shifts with server timezone.
function parseDateOfBirth(value) {
  const str = String(value).trim();
  let m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  let day, month, year;
  if (m) [, day, month, year] = m.map(Number);
  else if ((m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [, year, month, day] = m.map(Number);
  else throw new ApiError(422, 'Validation failed', [{ field: 'dateOfBirth', message: 'Enter date of birth as DD/MM/YYYY' }]);

  const dob = new Date(Date.UTC(year, month - 1, day));
  if (dob.getUTCFullYear() !== year || dob.getUTCMonth() !== month - 1 || dob.getUTCDate() !== day) {
    throw new ApiError(422, 'Validation failed', [{ field: 'dateOfBirth', message: 'Enter a valid date of birth' }]);
  }

  const now = new Date();
  const eighteenthBirthday = new Date(Date.UTC(year + MIN_PICKER_AGE, month - 1, day));
  if (dob > now || year < now.getUTCFullYear() - 100) {
    throw new ApiError(422, 'Validation failed', [{ field: 'dateOfBirth', message: 'Enter a valid date of birth' }]);
  }
  if (eighteenthBirthday > now) {
    throw new ApiError(422, 'Validation failed', [{ field: 'dateOfBirth', message: `You must be at least ${MIN_PICKER_AGE} years old to register` }]);
  }
  return dob;
}

// POST /auth/picker/register  { name, email, gender, dateOfBirth }
// The "Register — Tell us a bit about you" step right after OTP signup. The mobile number shown
// on that screen is the account's OTP-verified phone (read-only, returned in `user.phone`), so it
// isn't accepted here. Can be called again to correct details before approval.
const register = catchAsync(async (req, res) => {
  const { name, email, gender } = req.body;
  const dateOfBirth = parseDateOfBirth(req.body.dateOfBirth);

  const emailTaken = await User.exists({ email, _id: { $ne: req.user._id } });
  if (emailTaken) {
    throw new ApiError(409, 'This email is already used by another account', [{ field: 'email', message: 'This email is already used by another account' }]);
  }

  req.user.name = name;
  req.user.email = email;
  req.user.gender = gender;
  req.user.dateOfBirth = dateOfBirth;
  await req.user.save();

  const profile = await PickerProfile.findOne({ user: req.user._id });
  new ApiResponse(200, {
    user: safeUserOf(req.user),
    pickerProfile: profile,
    onboarding: pickerOnboarding(req.user, profile),
  }, 'Profile saved').send(res);
});

// A logged-out picker can't receive pick jobs, so take them offline/unavailable (otherwise
// assignment could keep routing orders to a phone nobody is signed in on) and drop the push token.
async function takePickerOffline(user) {
  await PickerProfile.updateOne({ user: user._id }, { isAvailable: false, onlineStatus: 'offline' });
  if (user.fcmToken) {
    user.fcmToken = null;
    await user.save();
  }
}

// POST /auth/picker/logout  { refreshToken } — signs out this device only.
const logout = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  const revoked = await tokenService.revokeRefreshToken(refreshToken, req.user._id);
  if (!revoked) throw new ApiError(400, 'Invalid or already-revoked refresh token');
  await takePickerOffline(req.user);
  new ApiResponse(200, null, 'Logged out').send(res);
});

// POST /auth/picker/logout-all — signs out every device this picker is logged in on.
const logoutAll = catchAsync(async (req, res) => {
  await tokenService.revokeAllForUser(req.user._id);
  await takePickerOffline(req.user);
  new ApiResponse(200, null, 'Logged out from all devices').send(res);
});

module.exports = { sendOtp, resendOtp, verifyOtp, me, register, logout, logoutAll };
