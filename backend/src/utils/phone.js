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

module.exports = { resolvePhone };
