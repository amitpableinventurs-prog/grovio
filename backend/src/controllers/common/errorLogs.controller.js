const ApiError = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const catchAsync = require('../../utils/catchAsync');
const { saveClientErrors, allowClientReport } = require('../../services/errorLog.service');

// POST /common/error-logs — the Customer / Picker / Delivery apps (or a web panel) report an error
// they hit. Login optional: errors before sign-in or with an expired token count too.
const reportErrors = catchAsync(async (req, res) => {
  const { errors } = req.body;
  if (!allowClientReport(req.ip, errors.length)) throw new ApiError(429, 'Too many error reports, try again later');
  const saved = await saveClientErrors(errors, req);
  new ApiResponse(201, { saved }, 'Error logged').send(res);
});

module.exports = { reportErrors };
