const { Notification } = require('../../models');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');

const listNotifications = catchAsync(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const [rows, count] = await Promise.all([
    Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).skip(offset).limit(limit),
    Notification.countDocuments({ user: req.user.id }),
  ]);
  new ApiResponse(200, { items: rows, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

const markAsRead = catchAsync(async (req, res) => {
  const notification = await Notification.findOne({ _id: req.params.id, user: req.user.id });
  if (!notification) throw new ApiError(404, 'Notification not found');
  notification.isRead = true;
  await notification.save();
  new ApiResponse(200, notification).send(res);
});

const markAllAsRead = catchAsync(async (req, res) => {
  await Notification.updateMany({ user: req.user.id, isRead: false }, { isRead: true });
  new ApiResponse(200, null, 'All notifications marked as read').send(res);
});

const registerFcmToken = catchAsync(async (req, res) => {
  const { fcmToken } = req.body;
  req.user.fcmToken = fcmToken;
  await req.user.save();
  new ApiResponse(200, null, 'Token registered').send(res);
});

module.exports = { listNotifications, markAsRead, markAllAsRead, registerFcmToken };
