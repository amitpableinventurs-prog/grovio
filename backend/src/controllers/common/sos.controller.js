const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const { getPagination, buildPageMeta } = require('../../utils/pagination');
const sos = require('../../services/sos.service');

// SOS from the Picker, Delivery and Customer apps — see services/sos.service.js.
const SOS_ROLES = ['customer', 'picker', 'delivery'];
function assertSosRole(user) {
  if (!SOS_ROLES.includes(user.role)) throw new ApiError(403, 'SOS is for the Customer, Picker and Delivery apps');
}

// GET /common/sos/config -> helpline numbers, my emergency contact, my open alert (if any)
const getConfig = catchAsync(async (req, res) => {
  assertSosRole(req.user);
  new ApiResponse(200, await sos.getConfig(req.user)).send(res);
});

// POST /common/sos { kind, lat, lng, accuracy?, note?, orderId? }
const raise = catchAsync(async (req, res) => {
  assertSosRole(req.user);
  const result = await sos.raise(req.user, req.body);
  new ApiResponse(result.created ? 201 : 200, result, result.created ? 'SOS sent. Our team has been alerted.' : 'SOS updated').send(res);
});

// POST /common/sos/:id/location { lat, lng, accuracy? }
const addLocation = catchAsync(async (req, res) => {
  assertSosRole(req.user);
  new ApiResponse(200, await sos.addLocation(req.user, req.params.id, req.body), 'Location updated').send(res);
});

// POST /common/sos/:id/cancel { reason? }
const cancel = catchAsync(async (req, res) => {
  assertSosRole(req.user);
  new ApiResponse(200, await sos.cancel(req.user, req.params.id, req.body), 'SOS cancelled').send(res);
});

// GET /common/sos -> my past alerts
const listMine = catchAsync(async (req, res) => {
  assertSosRole(req.user);
  const { page, limit, offset } = getPagination(req.query);
  const { items, count } = await sos.listMine(req.user, { offset, limit });
  new ApiResponse(200, { items, meta: buildPageMeta({ page, limit, count }) }).send(res);
});

module.exports = { getConfig, raise, addLocation, cancel, listMine };
