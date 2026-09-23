const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const ctrl = require('../controllers/picker/picker.controller');

router.use(authenticate, authorize('picker'));

router.get('/profile', ctrl.getProfile);
router.patch('/profile', upload.fields([{ name: 'idProofDocument', maxCount: 1 }]), ctrl.updateProfile);
router.patch('/availability', ctrl.toggleAvailability);
router.post('/location', ctrl.updateLocation);
router.get('/location', ctrl.getLocation);

router.get('/jobs', ctrl.listJobs);
router.get('/jobs/:id', ctrl.getJobDetail);
router.post('/jobs/:id/start', ctrl.startPicking);
router.patch('/jobs/:id/items/:itemId', ctrl.updateJobItem);
router.post('/jobs/:id/substitutions', ctrl.recordSubstitution);
router.post('/jobs/:id/complete', ctrl.completeMyPicking);
router.get('/jobs/:id/otp', ctrl.getHandoverOtp);
router.get('/jobs/:id/qr', ctrl.getHandoverQr);

router.get('/history', ctrl.listHistory);
router.get('/performance', ctrl.getPerformance);

module.exports = router;
