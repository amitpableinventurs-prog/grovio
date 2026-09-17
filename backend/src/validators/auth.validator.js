const { body } = require('express-validator');

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
];

module.exports = { loginRules, sendOtpRules, verifyOtpRules };
