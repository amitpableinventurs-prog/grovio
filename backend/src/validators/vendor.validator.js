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

const vendorLoginRules = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

module.exports = { registerVendorRules, vendorLoginRules };
