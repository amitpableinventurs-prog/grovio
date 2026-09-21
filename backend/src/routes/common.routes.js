const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

const publicCtrl = require('../controllers/common/public.controller');
const notificationsCtrl = require('../controllers/common/notifications.controller');
const supportCtrl = require('../controllers/common/support.controller');

// Public
router.get('/banners', publicCtrl.listActiveBanners);
router.get('/content/:slug', publicCtrl.getContentPage);

// Authenticated (any role)
router.post('/upload', authenticate, upload.single('file'), publicCtrl.uploadFile);
router.post('/fcm-token', authenticate, notificationsCtrl.registerFcmToken);

router.get('/notifications', authenticate, notificationsCtrl.listNotifications);
router.patch('/notifications/:id/read', authenticate, notificationsCtrl.markAsRead);
router.patch('/notifications/read-all', authenticate, notificationsCtrl.markAllAsRead);

router.post('/support', authenticate, supportCtrl.createTicket);
router.get('/support', authenticate, supportCtrl.listMyTickets);

module.exports = router;
