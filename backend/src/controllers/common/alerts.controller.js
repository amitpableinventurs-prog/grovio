const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const catchAsync = require('../../utils/catchAsync');
const { APPS, liveForApp } = require('../../services/appAlert.service');

// GET /common/alerts — the alerts this app should show now. Signed in: the user's role decides the
// app; signed out (e.g. the customer app before login): ?app=customer.
const listAlerts = catchAsync(async (req, res) => {
  const app = APPS.includes(req.user?.role) ? req.user.role : req.query.app;
  if (!app) throw new ApiError(400, `Sign in, or pass ?app= (${APPS.join(', ')})`);
  new ApiResponse(200, await liveForApp(app)).send(res);
});

module.exports = { listAlerts };
