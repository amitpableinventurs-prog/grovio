const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const authCtrl = require('../controllers/auth/auth.controller');

router.use('/auth', require('./auth.routes'));
router.use('/admin', require('./admin.routes'));
router.use('/customer', require('./customer.routes'));
router.use('/picker', require('./picker.routes'));
router.use('/delivery', require('./delivery.routes'));
router.use('/common', require('./common.routes'));

// Top-level aliases (some client conventions call these directly, not under /auth)
router.get('/me', authenticate, authCtrl.me);
router.put('/me', authenticate, authCtrl.updateMe);

module.exports = router;
