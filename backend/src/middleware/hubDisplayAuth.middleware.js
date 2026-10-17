const ApiError = require('../utils/apiError');
const catchAsync = require('../utils/catchAsync');
const { HubDisplay } = require('../models');
const { findDisplayByKey } = require('../services/hubDisplay.service');

// How often lastSeenAt is written — it's shown to admins, it doesn't need to be exact.
const LAST_SEEN_WRITE_MS = 60 * 1000;

// Authenticates a Hub Center screen (models/hubDisplay.model.js) by the device key in the
// X-Hub-Display-Key header. Sets req.hubDisplay (store populated). There is no user on these
// requests — only /hub-display/* routes use this.
const authenticateHubDisplay = catchAsync(async (req, res, next) => {
  const display = await findDisplayByKey(req.get('X-Hub-Display-Key'));
  if (!display) throw new ApiError(401, 'Hub screen key is invalid or has been revoked');

  if (!display.lastSeenAt || Date.now() - display.lastSeenAt.getTime() > LAST_SEEN_WRITE_MS) {
    await HubDisplay.updateOne({ _id: display._id }, { $set: { lastSeenAt: new Date() } });
  }

  req.hubDisplay = display;
  next();
});

module.exports = { authenticateHubDisplay };
