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

// POST /auth/picker/register — the "Register / Tell us a bit about you" screen. The mobile number
// shown there is read-only (it's the one verified by OTP), so it isn't part of the body. Date
// parsing and the minimum-age check live in pickerAuth.controller.js#parseDateOfBirth.
const pickerRegisterRules = [
  body('name').trim().isLength({ min: 2, max: 60 }).withMessage('Enter your full name (2–60 characters)'),
  body('email').trim().isEmail().withMessage('Enter a valid email address').normalizeEmail({ gmail_remove_dots: false }),
  body('gender').trim().toLowerCase().isIn(['male', 'female', 'other']).withMessage('Select your gender (male, female or other)'),
  body('dateOfBirth').notEmpty().withMessage('Enter your date of birth (DD/MM/YYYY)').bail().isString().withMessage('Enter date of birth as DD/MM/YYYY'),
];

const pickerLogoutRules = [
  body('refreshToken').notEmpty().withMessage('refreshToken is required').isString(),
];

module.exports = { registerVendorRules, loginRules, sendOtpRules, verifyOtpRules, pickerVerifyOtpRules, pickerRegisterRules, pickerLogoutRules };
