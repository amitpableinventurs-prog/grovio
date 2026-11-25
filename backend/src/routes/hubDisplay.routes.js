const router = require('express').Router();
const { authenticateHubDisplay } = require('../middleware/hubDisplayAuth.middleware');
const ctrl = require('../controllers/hubDisplay/hubDisplay.controller');

// Hub Center screen (the /hub-display page) — device-key auth, not a user login.
router.use(authenticateHubDisplay);

router.get('/board', ctrl.getBoard);
router.get('/checkin-qr', ctrl.getCheckinQr);
// The same paired screen used as a picker TV at any store (/picker-display).
router.get('/picking-board', ctrl.getPickingBoard);

module.exports = router;
