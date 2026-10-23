const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

const publicCtrl = require('../controllers/common/public.controller');
const notificationsCtrl = require('../controllers/common/notifications.controller');
const sosCtrl = require('../controllers/common/sos.controller');
const supportCtrl = require('../controllers/common/support.controller');
const announcementsCtrl = require('../controllers/common/announcements.controller');

// Public
router.get('/banners', publicCtrl.listActiveBanners);
router.get('/content/:slug', publicCtrl.getContentPage);
router.get('/wishlist/:shareToken', publicCtrl.getSharedWishlist);

// Authenticated (any role)
router.post('/upload', authenticate, upload.single('file'), publicCtrl.uploadFile);
router.post('/fcm-token', authenticate, notificationsCtrl.registerFcmToken);

// SOS (Customer / Picker / Delivery apps) — services/sos.service.js.
router.get('/sos/config', authenticate, sosCtrl.getConfig);
router.get('/sos', authenticate, sosCtrl.listMine);
router.post('/sos', authenticate, sosCtrl.raise);
router.post('/sos/:id/location', authenticate, sosCtrl.addLocation);
router.post('/sos/:id/cancel', authenticate, sosCtrl.cancel);

router.get('/notifications', authenticate, notificationsCtrl.listNotifications);
router.patch('/notifications/:id/read', authenticate, notificationsCtrl.markAsRead);
router.patch('/notifications/read-all', authenticate, notificationsCtrl.markAllAsRead);

// Company notices (Updates tab): list, badge count, details, "Okay, I understand".
router.get('/announcements', authenticate, announcementsCtrl.list);
router.get('/announcements/unread-count', authenticate, announcementsCtrl.unreadCount);
router.get('/announcements/:id', authenticate, announcementsCtrl.detail);
router.post('/announcements/:id/ack', authenticate, announcementsCtrl.acknowledge);

router.get('/support/categories', authenticate, supportCtrl.listCategories);
router.post('/support', authenticate, supportCtrl.createTicket);
router.get('/support', authenticate, supportCtrl.listMyTickets);
router.get('/support/:id', authenticate, supportCtrl.getTicket);
router.post('/support/:id/messages', authenticate, supportCtrl.addMessage);
router.post('/support/:id/rate', authenticate, supportCtrl.rateTicket);
router.post('/support/:id/reopen', authenticate, supportCtrl.reopenTicket);

module.exports = router;
