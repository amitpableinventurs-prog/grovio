const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/voip/voip.controller');

// In-app masked calling (services/voip.service.js). The call endpoints themselves live with the
// order they're about: POST /customer/orders/:id/call and POST /delivery/jobs/:id/call.
router.get('/token', authenticate, authorize('customer', 'delivery'), ctrl.getToken);

// Twilio webhooks — public, verified by X-Twilio-Signature. Point the TwiML App's Voice URL at
// /voice and its Status Callback at /status (Admin > Settings shows the full URLs).
router.post('/twilio/voice', ctrl.checkSignature, ctrl.voice);
router.post('/twilio/dial-result', ctrl.checkSignature, ctrl.dialResult);
router.post('/twilio/client-status', ctrl.checkSignature, ctrl.clientStatus);
router.post('/twilio/status', ctrl.checkSignature, ctrl.status);

module.exports = router;
