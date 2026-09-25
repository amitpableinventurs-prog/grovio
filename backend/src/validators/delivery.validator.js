const { body } = require('express-validator');
const { VEHICLE_TYPES } = require('../utils/deliveryOnboarding');

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_REGEX = /^[2-9][0-9]{11}$/;
const MIN_AGE = 18;

const vehicleRules = [
  body('vehicleType').trim().isIn(VEHICLE_TYPES.map((v) => v.value))
    .withMessage(`Select a vehicle (${VEHICLE_TYPES.map((v) => v.value).join(', ')})`),
];

// Sent as multipart/form-data alongside the `document` photo (the ID card itself).
const identityRules = [
  body('idType').trim().toLowerCase().isIn(['pan', 'aadhaar']).withMessage('idType must be pan or aadhaar'),
  // The app shows Aadhaar as "1234 5678 9012" — spaces are dropped before checking.
  body('idNumber').customSanitizer((v) => String(v ?? '').replace(/\s+/g, '').toUpperCase())
    .custom((value, { req }) => {
      if (req.body.idType === 'pan' && !PAN_REGEX.test(value)) throw new Error('Enter a valid PAN number (e.g. ABCDE1234F)');
      if (req.body.idType === 'aadhaar' && !AADHAAR_REGEX.test(value)) throw new Error('Enter a valid 12-digit Aadhaar number');
      return true;
    }),
  body('fullName').trim().isLength({ min: 2, max: 60 }).withMessage('Enter your full name as on the card (2–60 characters)'),
  body('gender').trim().toLowerCase().isIn(['male', 'female', 'other']).withMessage('Select your gender (male, female or other)'),
  body('fatherName').trim().isLength({ min: 2, max: 60 }).withMessage("Enter your father's name (2–60 characters)"),
  body('dateOfBirth').trim().isISO8601({ strict: true, strictSeparator: true }).withMessage('Enter date of birth as YYYY-MM-DD')
    .bail()
    .custom((value) => {
      const dob = new Date(`${value}T00:00:00Z`);
      const adultOn = new Date(dob);
      adultOn.setUTCFullYear(dob.getUTCFullYear() + MIN_AGE);
      if (adultOn > new Date()) throw new Error(`You must be at least ${MIN_AGE} years old`);
      return true;
    }),
];

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_REGEX = /^[0-9]{9,18}$/;

// Payout bank account. `prefix` is '' for the app's onboarding form and 'bankDetails.' for the
// admin create/edit form, where the whole section is optional (only what's sent is checked).
function bankRules(prefix = '', { optional = false } = {}) {
  const field = (name) => {
    const chain = body(`${prefix}${name}`);
    return optional ? chain.optional({ values: 'falsy' }) : chain;
  };
  return [
    field('accountHolderName').trim().isLength({ min: 2, max: 60 }).withMessage('Enter the account holder name (2–60 characters)'),
    field('accountNumber').customSanitizer((v) => String(v ?? '').replace(/\s+/g, ''))
      .matches(ACCOUNT_NUMBER_REGEX).withMessage('Enter a valid bank account number (9–18 digits)'),
    // The app's "Re-enter account number" field — checked only when sent.
    body(`${prefix}confirmAccountNumber`).optional({ values: 'falsy' })
      .customSanitizer((v) => String(v ?? '').replace(/\s+/g, ''))
      .custom((value, { req }) => {
        const account = prefix ? req.body.bankDetails?.accountNumber : req.body.accountNumber;
        if (value !== account) throw new Error("Account numbers don't match");
        return true;
      }),
    field('ifsc').trim().toUpperCase().matches(IFSC_REGEX).withMessage('Enter a valid IFSC code (e.g. SBIN0001234)'),
    body(`${prefix}bankName`).optional({ values: 'falsy' }).trim().isLength({ max: 80 }).withMessage('Bank name is too long'),
  ];
}

module.exports = { vehicleRules, identityRules, bankRules };
