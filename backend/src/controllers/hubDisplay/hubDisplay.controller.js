const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const {
  QR_ROTATE_SECONDS,
  getOrRotateCheckinToken,
  publicBaseUrl,
  checkinUrl,
  qrSvg,
  buildBoard,
} = require('../../services/hubDisplay.service');

// Endpoints for the Hub Center screen itself (/hub-display page), authenticated by its device key
// — see middleware/hubDisplayAuth.middleware.js.

// GET /hub-display/board -> which screen/hub this is, plus the hub's preparing and ready orders.
// The screen calls this on load and again whenever a 'hub:order' socket event arrives.
const getBoard = catchAsync(async (req, res) => {
  const { store } = req.hubDisplay;
  const board = await buildBoard(store._id);
  new ApiResponse(200, {
    display: { id: req.hubDisplay._id, name: req.hubDisplay.name },
    hub: { id: store._id, name: store.name, address: store.address },
    ...board,
    serverTime: new Date(),
  }).send(res);
});

// GET /hub-display/checkin-qr -> the current check-in QR (as SVG markup) and when to fetch the
// next one. Delivery partners scan it from the delivery app — POST /delivery/hub/checkin.
const getCheckinQr = catchAsync(async (req, res) => {
  const current = await getOrRotateCheckinToken(req.hubDisplay._id);
  if (!current) throw new ApiError(401, 'Hub screen key is invalid or has been revoked');

  const url = checkinUrl(publicBaseUrl(req), current.token);
  new ApiResponse(200, {
    qrSvg: await qrSvg(url),
    refreshAt: current.refreshAt,
    rotateSeconds: QR_ROTATE_SECONDS,
    serverTime: new Date(),
  }).send(res);
});

module.exports = { getBoard, getCheckinQr };
