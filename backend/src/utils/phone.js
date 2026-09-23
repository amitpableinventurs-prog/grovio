const ApiError = require('./apiError');

// Accepts either `{ phone }` (already-combined, e.g. "+919876543210") or
// `{ countryCode, mobile }` (e.g. "+91" + "9876543210") — the Flutter apps send the
// latter (see the Customer app onboarding doc), while Swagger/Postman testing is
// often quicker with a single `phone` field. Both resolve to the same canonical
// "+<countrycode><number>" string used as the unique key everywhere else.
function resolvePhone(body) {
  const { phone, countryCode, mobile } = body;

  if (countryCode && mobile) {
    const cc = String(countryCode).trim().replace(/[^\d+]/g, '');
    const num = String(mobile).trim().replace(/\D/g, '');
    if (!num) throw new ApiError(400, 'A valid mobile number is required');
    return `${cc.startsWith('+') ? cc : `+${cc}`}${num}`;
  }

  if (phone) {
    const trimmed = String(phone).trim();
    if (!trimmed) throw new ApiError(400, 'A valid mobile number is required');
    return trimmed;
  }

  throw new ApiError(400, 'Either { countryCode, mobile } or { phone } is required');
}

// OTP login/signup (/auth/send-otp, /auth/verify-otp, /auth/picker/*) takes the number the way
// every app's login screen collects it: `mobile` (digits only) with the country code fixed to
// +91 in the UI — `countryCode` is optional and defaults to that. No combined `phone` field.
// Resolves to the same canonical "+919876543210" form resolvePhone above produces.
const DEFAULT_COUNTRY_CODE = '+91';
function resolveMobile(body) {
  const mobile = String(body.mobile ?? '').trim();
  const digits = String(body.countryCode ?? DEFAULT_COUNTRY_CODE).replace(/\D/g, '');
  const cc = `+${digits}`;
  const validLength = cc === DEFAULT_COUNTRY_CODE ? /^\d{10}$/ : /^\d{6,14}$/;
  if (!digits || !validLength.test(mobile)) {
    throw new ApiError(400, cc === DEFAULT_COUNTRY_CODE ? 'Enter a valid 10-digit mobile number' : 'Enter a valid mobile number');
  }
  return `${cc}${mobile}`;
}

module.exports = { resolvePhone, resolveMobile };
