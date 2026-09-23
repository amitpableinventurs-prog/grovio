const { body } = require('express-validator');

const registerVendorRules = [
  body('name').notEmpty().withMessage('name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('storeName').notEmpty().withMessage('storeName is required'),
  body('phone').optional().isString(),
  body('address').optional().isString(),
  body('lat').optional().isFloat(),
  body('lng').optional().isFloat(),
];

const loginRules = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

// OTP endpoints take `mobile` only (no combined `phone`); countryCode is optional and defaults to
// +91. The exact digit-count check lives in utils/phone.js#resolveMobile.
const sendOtpRules = [
  body('mobile').notEmpty().withMessage('mobile is required').isString(),
  body('countryCode').optional().isString(),
];

const verifyOtpRules = [
  ...sendOtpRules,
  body('otp').optional().isString(),
  body('code').optional().isString(),
  body('deviceId').optional().isString(),
  body('role').optional().isIn(['customer', 'picker', 'delivery']),
  // Required only when role === 'delivery' on first-time signup — enforced in the controller
  // (where the specific "which field is missing" message is clearer than a generic 422).
  body('vehicleType').optional().isString(),
  body('vehicleNumber').optional().isString(),
  body('licenseNumber').optional().isString(),
];

// POST /auth/picker/verify-otp — role is implied, so no role/vehicle fields.
const pickerVerifyOtpRules = [
  ...sendOtpRules,
  body('otp').notEmpty().withMessage('otp is required').isString(),
  body('name').optional().isString(),
  body('deviceId').optional().isString(),
  body('platform').optional().isIn(['android', 'ios', 'web']),
];

const pickerLogoutRules = [
  body('refreshToken').notEmpty().withMessage('refreshToken is required').isString(),
];

module.exports = { registerVendorRules, loginRules, sendOtpRules, verifyOtpRules, pickerVerifyOtpRules, pickerLogoutRules };
