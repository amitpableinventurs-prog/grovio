const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const ctrl = require('../controllers/picker/picker.controller');
const earningsCtrl = require('../controllers/picker/earnings.controller');

router.use(authenticate, authorize('picker'));

const kycDocumentUpload = upload.fields([{ name: 'idProofDocument', maxCount: 1 }]);

router.get('/profile', ctrl.getProfile);
router.patch('/kyc-upload', kycDocumentUpload, ctrl.updateProfile);
// Old path for the same KYC upload — kept only so already-shipped app builds keep working; new
// clients use /kyc-upload above (the only one documented).
router.patch('/profile', kycDocumentUpload, ctrl.updateProfile);
router.patch('/availability', ctrl.toggleAvailability);
router.post('/location', ctrl.updateLocation);
router.get('/location', ctrl.getLocation);

router.get('/jobs', ctrl.listJobs);
router.get('/jobs/:id', ctrl.getJobDetail);
router.post('/jobs/:id/start', ctrl.startPicking);
// Turn down my part of an order before starting it; my items go to another picker.
router.post('/jobs/:id/reject', ctrl.rejectJob);
router.patch('/jobs/:id/items/:itemId', ctrl.updateJobItem);
router.post('/jobs/:id/substitutions', ctrl.recordSubstitution);
router.post('/jobs/:id/complete', ctrl.completeMyPicking);
router.get('/jobs/:id/otp', ctrl.getHandoverOtp);
router.get('/jobs/:id/qr', ctrl.getHandoverQr);

router.get('/history', ctrl.listHistory);
router.get('/performance', ctrl.getPerformance);

// Product-based pay (services/pickerPay.service.js): today's earning and progress, pay per order,
// earnings by period, picking errors, pocket.
router.get('/earnings/today', earningsCtrl.today);
router.get('/earnings/orders', earningsCtrl.orders);
router.get('/earnings/summary', earningsCtrl.summary);
router.get('/errors', earningsCtrl.errors);
router.get('/pocket', earningsCtrl.pocketSummary);
router.get('/pocket/statement', earningsCtrl.pocketStatement);

module.exports = router;
