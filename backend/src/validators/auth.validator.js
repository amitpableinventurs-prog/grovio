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

// Actual "must have countryCode+mobile OR phone" enforcement happens in utils/phone.js
// (resolvePhone) — express-validator here just checks the shape when fields are present.
const sendOtpRules = [
  body('countryCode').optional().isString(),
  body('mobile').optional().isString(),
  body('phone').optional().isString(),
];

const verifyOtpRules = [
  body('countryCode').optional().isString(),
  body('mobile').optional().isString(),
  body('phone').optional().isString(),
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

module.exports = { registerVendorRules, loginRules, sendOtpRules, verifyOtpRules };
