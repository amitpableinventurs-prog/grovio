const router = require('express').Router();
const ctrl = require('../controllers/auth/auth.controller');
const pickerCtrl = require('../controllers/auth/pickerAuth.controller');
const validate = require('../middleware/validate.middleware');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  registerVendorRules,
  loginRules,
  sendOtpRules,
  verifyOtpRules,
  pickerVerifyOtpRules,
  pickerLogoutRules,
} = require('../validators/auth.validator');

router.post('/register-vendor', registerVendorRules, validate, ctrl.registerVendor);
router.post('/login', loginRules, validate, ctrl.loginWithPassword);
router.post('/send-otp', sendOtpRules, validate, ctrl.sendOtp);
router.post('/resend-otp', sendOtpRules, validate, ctrl.resendOtp);
router.post('/verify-otp', verifyOtpRules, validate, ctrl.verifyOtp);
router.post('/refresh', ctrl.refresh);

// Picker app: phone + OTP login/signup, locked to role 'picker' (see pickerAuth.controller.js).
router.post('/picker/send-otp', sendOtpRules, validate, pickerCtrl.sendOtp);
router.post('/picker/resend-otp', sendOtpRules, validate, pickerCtrl.resendOtp);
router.post('/picker/verify-otp', pickerVerifyOtpRules, validate, pickerCtrl.verifyOtp);
router.get('/picker/me', authenticate, authorize('picker'), pickerCtrl.me);
router.post('/picker/logout', authenticate, authorize('picker'), pickerLogoutRules, validate, pickerCtrl.logout);
router.post('/picker/logout-all', authenticate, authorize('picker'), pickerCtrl.logoutAll);

// Google/Apple social login are not wired up yet — they need OAuth app credentials
// (Google client ID/secret, Apple key) from the client team before the token-verification
// step can be implemented. Placeholders return 501 so clients get a clear signal.
router.post('/google', (req, res) => res.status(501).json({ success: false, message: 'Google login is not configured yet' }));
router.post('/apple', (req, res) => res.status(501).json({ success: false, message: 'Apple login is not configured yet' }));

router.get('/me', authenticate, ctrl.me);
router.put('/me', authenticate, ctrl.updateMe);
router.post('/logout', authenticate, ctrl.logout);
router.post('/logout-all', authenticate, ctrl.logoutAll);

module.exports = router;
