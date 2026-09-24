const crypto = require('crypto');
const catchAsync = require('../../utils/catchAsync');
const ApiError = require('../../utils/apiError');
const ivr = require('../../services/ivr.service');

// Webhooks the Exotel call flows hit (see services/ivr.service.js and README "IVR"). Public, no
// user auth: Exotel doesn't sign requests, so every URL carries a secret token segment instead.
// Exotel sends applet parameters in the query string (GET) and status callbacks as JSON or form
// POSTs — both are merged into one params object here.

const params = (req) => ({ ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) });
const text = (res, body) => res.status(200).type('text/plain').send(body);

const checkToken = catchAsync(async (req, res, next) => {
  const expected = Buffer.from(await ivr.webhookToken());
  const given = Buffer.from(String(req.params.token || ''));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new ApiError(404, 'Not found');
  next();
});

// Greeting applet (dynamic text): ?stage=main|result
const prompt = catchAsync(async (req, res) => text(res, await ivr.prompt(params(req))));

// Passthru after Gather on the confirmation flow.
const input = catchAsync(async (req, res) => {
  await ivr.handleInput(params(req));
  text(res, 'OK');
});

// StatusCallback when a call ends.
const status = catchAsync(async (req, res) => {
  await ivr.handleStatus(params(req));
  text(res, 'OK');
});

// Passthru on the missed-call number.
const missedCall = catchAsync(async (req, res) => {
  await ivr.handleMissedCall(params(req));
  text(res, 'OK');
});

// Customer care flow.
const carePrompt = catchAsync(async (req, res) => text(res, await ivr.carePrompt(params(req))));
const careInput = catchAsync(async (req, res) => {
  const { connectAgent } = await ivr.careInput(params(req));
  // Passthru: 200 -> success branch (read the result), 302 -> failure branch (Connect to support).
  res.status(connectAgent ? 302 : 200).type('text/plain').send(connectAgent ? 'CONNECT' : 'OK');
});
const careResult = catchAsync(async (req, res) => text(res, await ivr.careResult(params(req))));

module.exports = { checkToken, prompt, input, status, missedCall, carePrompt, careInput, careResult };
