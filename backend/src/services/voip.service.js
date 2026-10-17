const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { VoipCall, Order, User } = require('../models');
const ApiError = require('../utils/apiError');
const { getSetting } = require('./settings.service');

// Masked calls between a customer and their delivery partner, as in-app VoIP over Twilio Voice.
// Neither side ever gets the other's phone number: the apps call each other by an opaque Twilio
// client identity (u_<userId>), and the only things the callee is shown are the caller's first
// name, role and the order number.
//
// Flow:
//   1. App gets a Twilio access token (GET /voip/token) and registers its Voice SDK Device, so it
//      can receive calls (web: while the tab is open; mobile: via the push credential).
//   2. Caller taps "Call" -> POST /customer/orders/:id/call or /delivery/jobs/:id/call. We check
//      they're on the order and it's still out for delivery, and record a VoipCall ('initiated').
//   3. App connects with device.connect({ params: { callId } }). Twilio posts to our TwiML App
//      voice URL (/voip/twilio/voice), where we check the call again and answer with
//      <Dial><Client> to the other party's identity.
//   4. Twilio reports the outcome to /voip/twilio/dial-result, /client-status and /status.
//
// With no provider configured, calls are recorded as 'simulated' and nothing is dialled.

// Order statuses in which the customer and the assigned rider may call each other.
const CALLABLE_STATUSES = ['assigned', 'picked_up', 'out_for_delivery'];
// How long an app has to connect after POST .../call before the call id stops working.
const CONNECT_WINDOW_MS = 2 * 60 * 1000;
const TOKEN_TTL_SEC = 3600;
const ROLE_WORDS = { customer: 'customer', delivery: 'delivery partner' };

// ---- Settings -------------------------------------------------------------------------------

async function voipConfig() {
  const ring = Number(await getSetting('voipRingSeconds', 'VOIP_RING_SECONDS'));
  return {
    provider: (await getSetting('voipProvider', 'VOIP_PROVIDER')) || 'none',
    accountSid: await getSetting('twilioAccountSid', 'TWILIO_ACCOUNT_SID'),
    authToken: await getSetting('twilioAuthToken', 'TWILIO_AUTH_TOKEN'),
    apiKeySid: await getSetting('twilioApiKeySid', 'TWILIO_API_KEY_SID'),
    apiKeySecret: await getSetting('twilioApiKeySecret', 'TWILIO_API_KEY_SECRET'),
    twimlAppSid: await getSetting('twilioTwimlAppSid', 'TWILIO_TWIML_APP_SID'),
    pushCredentials: {
      android: await getSetting('twilioPushCredentialAndroid', 'TWILIO_PUSH_CREDENTIAL_ANDROID'),
      ios: await getSetting('twilioPushCredentialIos', 'TWILIO_PUSH_CREDENTIAL_IOS'),
    },
    ringSeconds: Number.isFinite(ring) && ring >= 10 && ring <= 60 ? ring : 30,
    baseUrl: ((await getSetting('publicBaseUrl', 'PUBLIC_BASE_URL')) || '').replace(/\/+$/, ''),
  };
}

function missingConfig(cfg) {
  const missing = ['accountSid', 'authToken', 'apiKeySid', 'apiKeySecret', 'twimlAppSid'].filter((k) => !cfg[k]);
  if (!cfg.baseUrl) missing.push('publicBaseUrl');
  return missing;
}

function webhookUrls(baseUrl) {
  const root = `${baseUrl}/api/v1/voip/twilio`;
  return { voice: `${root}/voice`, status: `${root}/status`, dialResult: `${root}/dial-result`, clientStatus: `${root}/client-status` };
}

// ---- Access tokens --------------------------------------------------------------------------

const identityOf = (userId) => `u_${userId}`;

// A Twilio access token with a Voice grant (the same JWT twilio-node's AccessToken builds).
// platform picks the push credential, so a mobile app gets incoming calls while in background.
async function accessToken(user, platform = 'web') {
  const cfg = await voipConfig();
  if (cfg.provider !== 'twilio') return { enabled: false };
  const missing = missingConfig(cfg);
  if (missing.length) throw new ApiError(503, `In-app calling is not fully configured (missing: ${missing.join(', ')})`);

  const identity = identityOf(user.id);
  const now = Math.floor(Date.now() / 1000);
  const voice = {
    incoming: { allow: true },
    outgoing: { application_sid: cfg.twimlAppSid },
  };
  const pushCredentialSid = cfg.pushCredentials[platform];
  if (pushCredentialSid) voice.push_credential_sid = pushCredentialSid;

  const token = jwt.sign(
    {
      jti: `${cfg.apiKeySid}-${now}`,
      iss: cfg.apiKeySid,
      sub: cfg.accountSid,
      iat: now,
      exp: now + TOKEN_TTL_SEC,
      grants: { identity, voice },
    },
    cfg.apiKeySecret,
    { algorithm: 'HS256', header: { typ: 'JWT', cty: 'twilio-fpa;v=1' } },
  );
  return { enabled: true, identity, token, ttlSec: TOKEN_TTL_SEC, expiresAt: new Date((now + TOKEN_TTL_SEC) * 1000) };
}

// ---- Starting a call ------------------------------------------------------------------------

const idOf = (v) => (v && v._id ? v._id : v)?.toString();
const firstName = (name) => (name ? String(name).trim().split(/\s+/)[0] : '');

// Who the other party on this order is for `user`, or throws if they can't call right now.
function counterpartOf(order, user) {
  if (!CALLABLE_STATUSES.includes(order.orderStatus)) {
    throw new ApiError(400, 'Calls are only available while the order is out for delivery');
  }
  if (!order.delivery) throw new ApiError(400, 'No delivery partner is assigned to this order yet');
  if (user.role === 'customer' && idOf(order.customer) === user.id) return { userId: idOf(order.delivery), role: 'delivery' };
  if (user.role === 'delivery' && idOf(order.delivery) === user.id) return { userId: idOf(order.customer), role: 'customer' };
  throw new ApiError(403, 'You are not part of this order');
}

// POST .../call. Returns what the app needs to connect — never a phone number.
async function startCall(order, user) {
  const counterpart = counterpartOf(order, user);
  const callee = await User.findById(counterpart.userId).select('name isActive');
  if (!callee || !callee.isActive) throw new ApiError(400, `The ${ROLE_WORDS[counterpart.role]} can't be reached right now`);

  const cfg = await voipConfig();
  const live = cfg.provider === 'twilio';
  if (live) {
    const missing = missingConfig(cfg);
    if (missing.length) throw new ApiError(503, 'In-app calling is not available right now');
  }

  // One pending call per caller: an earlier call they never connected is dropped.
  await VoipCall.updateMany({ caller: user._id, status: 'initiated' }, { $set: { status: 'expired', endedAt: new Date() } });

  const call = await VoipCall.create({
    order: order._id,
    caller: user._id,
    callerRole: user.role,
    callee: callee._id,
    calleeRole: counterpart.role,
    provider: live ? 'twilio' : 'simulated',
    status: live ? 'initiated' : 'simulated',
  });
  if (!live) console.log(`[VoIP simulated] ${user.role} ${user.id} -> ${counterpart.role} ${callee.id} on ${order.orderNumber}`);

  return {
    callId: call.id,
    simulated: !live,
    orderNumber: order.orderNumber,
    callee: { role: counterpart.role, name: firstName(callee.name) || ROLE_WORDS[counterpart.role] },
    // Pass these to device.connect({ params }).
    params: { callId: call.id },
  };
}

// ---- Twilio webhooks ------------------------------------------------------------------------

// X-Twilio-Signature: base64 HMAC-SHA1 of the full URL + every POST param (sorted by name,
// name then value), keyed with the account auth token. The URL is rebuilt from publicBaseUrl,
// since behind a proxy req.protocol/host aren't what Twilio called.
function validSignature(cfg, req) {
  const given = String(req.get('X-Twilio-Signature') || '');
  if (!given || !cfg.authToken || !cfg.baseUrl) return false;
  const url = `${cfg.baseUrl}${req.originalUrl}`;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const data = Object.keys(body).sort().reduce((acc, key) => {
    const values = Array.isArray(body[key]) ? body[key] : [body[key]];
    return acc + values.map((v) => `${key}${v}`).join('');
  }, url);
  const expected = crypto.createHmac('sha1', cfg.authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function verifyWebhook(req) {
  const cfg = await voipConfig();
  if (cfg.provider !== 'twilio' || !validSignature(cfg, req)) return false;
  // Also refuse posts for some other Twilio account.
  return !req.body?.AccountSid || req.body.AccountSid === cfg.accountSid;
}

const xmlEscape = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const twiml = (inner = '') => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
const say = (text) => twiml(`<Say>${xmlEscape(text)}</Say><Hangup/>`);

async function findCall(callId) {
  return callId && /^[a-f\d]{24}$/i.test(callId) ? VoipCall.findById(callId) : null;
}

async function failCall(call, reason, spoken) {
  if (call) {
    call.status = 'failed';
    call.error = reason;
    call.endedAt = new Date();
    await call.save();
  }
  return say(spoken || 'Sorry, this call cannot be connected.');
}

// TwiML App voice URL: the caller's app has connected. Re-check everything (the order may have
// been reassigned or delivered since POST .../call) before bridging to the other app.
async function voiceTwiml(params) {
  const cfg = await voipConfig();
  const call = await findCall(params.callId);
  if (!call) return failCall(null, null);
  if (call.status !== 'initiated') return failCall(null, null, 'This call has already been used. Please tap call again.');
  if (Date.now() - call.createdAt.getTime() > CONNECT_WINDOW_MS) {
    call.status = 'expired';
    call.endedAt = new Date();
    await call.save();
    return say('This call has expired. Please tap call again.');
  }
  if (params.From !== `client:${identityOf(call.caller)}`) return failCall(call, `Connected from an unexpected identity (${params.From})`);

  const order = await Order.findById(call.order).select('orderNumber orderStatus customer delivery');
  if (!order) return failCall(call, 'Order not found');
  const caller = await User.findById(call.caller).select('name role');
  let counterpart;
  try {
    counterpart = counterpartOf(order, { id: call.caller.toString(), role: call.callerRole });
  } catch (err) {
    return failCall(call, err.message, 'Sorry, calls are no longer available for this order.');
  }
  if (counterpart.userId !== call.callee.toString()) return failCall(call, 'Order was reassigned', 'Sorry, this order now has a different delivery partner.');

  call.providerCallId = params.CallSid || null;
  call.status = 'ringing';
  await call.save();

  // Shown on the callee's incoming-call screen (call.customParameters in the SDK).
  const urls = webhookUrls(cfg.baseUrl);
  const q = `?callId=${call.id}`;
  const parameters = {
    callId: call.id,
    orderNumber: order.orderNumber,
    callerRole: call.callerRole,
    callerName: firstName(caller?.name) || ROLE_WORDS[call.callerRole],
  };
  const paramXml = Object.entries(parameters).map(([k, v]) => `<Parameter name="${k}" value="${xmlEscape(v)}"/>`).join('');
  return twiml(
    `<Dial answerOnBridge="true" timeout="${cfg.ringSeconds}" action="${xmlEscape(urls.dialResult + q)}" method="POST">`
    + `<Client statusCallbackEvent="answered" statusCallback="${xmlEscape(urls.clientStatus + q)}" statusCallbackMethod="POST">`
    + `<Identity>${identityOf(call.callee)}</Identity>${paramXml}</Client></Dial>`,
  );
}

// The callee picked up.
async function handleClientStatus(params) {
  const call = await findCall(params.callId);
  if (!call || String(params.CallStatus).toLowerCase() !== 'in-progress') return;
  if (['initiated', 'ringing'].includes(call.status)) {
    call.status = 'in-progress';
    call.answeredAt = new Date();
    await call.save();
  }
}

const DIAL_STATUS = { completed: 'completed', answered: 'completed', busy: 'busy', 'no-answer': 'no-answer', failed: 'failed', canceled: 'canceled' };
const FINAL = ['completed', 'busy', 'no-answer', 'failed', 'canceled', 'expired'];

// <Dial action>: how the bridge ended. What we return is played to the caller (if still there).
async function handleDialResult(params) {
  const call = await findCall(params.callId);
  const status = DIAL_STATUS[String(params.DialCallStatus || '').toLowerCase()] || 'failed';
  if (call && !FINAL.includes(call.status)) {
    call.status = status;
    const duration = Number(params.DialCallDuration);
    if (Number.isFinite(duration)) call.durationSec = duration;
    call.endedAt = new Date();
    await call.save();
  }
  if (['busy', 'no-answer', 'failed'].includes(status)) {
    const who = call ? ROLE_WORDS[call.calleeRole] : 'other person';
    return say(`The ${who} is not answering right now. Please try again in a moment.`);
  }
  return twiml('<Hangup/>');
}

// TwiML App status callback for the caller's leg: closes calls the dial result never reached,
// e.g. the caller hung up while it was still ringing.
async function handleStatus(params) {
  if (!['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(String(params.CallStatus || '').toLowerCase())) return;
  const call = params.CallSid ? await VoipCall.findOne({ providerCallId: params.CallSid }) : null;
  if (!call || FINAL.includes(call.status)) return;
  call.status = call.status === 'in-progress' ? 'completed' : 'canceled';
  if (call.answeredAt) call.durationSec = Math.round((Date.now() - call.answeredAt.getTime()) / 1000);
  call.endedAt = new Date();
  await call.save();
}

// Calls whose app never connected, for the admin log.
async function expireStaleCalls() {
  await VoipCall.updateMany(
    { status: 'initiated', createdAt: { $lt: new Date(Date.now() - CONNECT_WINDOW_MS) } },
    { $set: { status: 'expired' } },
  );
}

module.exports = {
  CALLABLE_STATUSES,
  voipConfig,
  missingConfig,
  webhookUrls,
  accessToken,
  startCall,
  verifyWebhook,
  voiceTwiml,
  handleClientStatus,
  handleDialResult,
  handleStatus,
  expireStaleCalls,
};
