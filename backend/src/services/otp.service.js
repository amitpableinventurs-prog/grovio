const { Otp } = require('../models');
const ApiError = require('../utils/apiError');
const { sendSms } = require('./sms.service');

const RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 30);
const MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 5);

function generateCode() {
  // In dev/testing, a fixed OTP (OTP_FIXED_CODE) means you never have to read the
  // debugOtp out of the response — just always type that same code. Leave
  // OTP_FIXED_CODE unset in production so real random OTPs are issued.
  if (process.env.OTP_FIXED_CODE) return process.env.OTP_FIXED_CODE;
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// POST /auth/send-otp and /auth/resend-otp both call this. Enforces the same
// server-side cooldown the Flutter UI's countdown assumes, so a client can't
// hammer the SMS provider by bypassing the UI timer.
async function sendOtp(phone) {
  const last = await Otp.findOne({ phone }).sort({ createdAt: -1 });
  if (last) {
    const secondsSinceLast = (Date.now() - last.createdAt.getTime()) / 1000;
    if (secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
      const retryAfter = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLast);
      throw new ApiError(429, `Please wait ${retryAfter}s before requesting another OTP`, [{ retryAfter }]);
    }
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + (Number(process.env.OTP_EXPIRY_MINUTES || 5) * 60 * 1000));

  await Otp.create({ phone, code, expiresAt });

  // Dev mode always logs the OTP too, regardless of whether an SMS provider is configured —
  // handy when testing against a provider sandbox that doesn't actually deliver to your phone.
  console.log(`[OTP] ${phone} -> ${code}`);

  const debugMode = process.env.OTP_DEBUG_MODE === 'true';
  const result = await sendSms(phone, `Your Grovio verification code is ${code}. It expires in ${process.env.OTP_EXPIRY_MINUTES || 5} minutes.`, { otpCode: code });

  // No provider configured (Admin > Settings > Integrations): fall back to the existing
  // dev-mode behavior below. A provider IS configured but the send actually failed: don't lie
  // and say it was sent unless debug mode is also on to give the tester another way to get the code.
  if (!result.sent && result.reason !== 'not_configured' && !debugMode) {
    throw new ApiError(502, 'Could not send the OTP SMS. Please try again shortly.');
  }

  return {
    sent: true,
    resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
    debugOtp: debugMode ? code : undefined,
  };
}

// Returns { valid, reason? } instead of a plain boolean so the controller can show
// a distinct message for "wrong code" vs "expired" vs "too many attempts" — the
// Customer app's OTP screen displays these inline, not as one generic error.
async function verifyOtp(phone, code) {
  const record = await Otp.findOne({ phone }).sort({ createdAt: -1 });

  if (!record || record.isUsed) return { valid: false, reason: 'not_found' };
  if (record.expiresAt < new Date()) return { valid: false, reason: 'expired' };
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) return { valid: false, reason: 'max_attempts' };

  if (record.code !== code) {
    record.attempts += 1;
    await record.save();
    const attemptsLeft = MAX_VERIFY_ATTEMPTS - record.attempts;
    return { valid: false, reason: attemptsLeft <= 0 ? 'max_attempts' : 'invalid', attemptsLeft: Math.max(attemptsLeft, 0) };
  }

  record.isUsed = true;
  await record.save();
  return { valid: true };
}

module.exports = { sendOtp, verifyOtp, RESEND_COOLDOWN_SECONDS, MAX_VERIFY_ATTEMPTS };
