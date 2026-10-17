const router = require('express').Router();
const ctrl = require('../controllers/ivr/exotel.controller');

// Exotel call-flow webhooks — public, guarded by the secret :token segment (see
// services/ivr.service.js#webhookToken). Admin > IVR shows the full URLs to paste into Exotel.
const hook = (path, handler) => router.all(`/exotel/:token${path}`, ctrl.checkToken, handler);

hook('/prompt', ctrl.prompt);
hook('/input', ctrl.input);
hook('/status', ctrl.status);
hook('/missed-call', ctrl.missedCall);
hook('/care/prompt', ctrl.carePrompt);
hook('/care/input', ctrl.careInput);
hook('/care/result', ctrl.careResult);

module.exports = router;
