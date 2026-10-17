const crypto = require('crypto');
const { IvrCall, Order, User, Setting, SupportTicket } = require('../models');
const { getSetting, invalidateSettingsCache } = require('./settings.service');
const { sendSms } = require('./sms.service');

// IVR (voice calls) for orders, built on Exotel (Indian cloud telephony). Covers:
//   - auto call notifications on order events      triggerOrderEvent()
//   - COD order confirmation call (1 = confirm, 2 = cancel)   requestOrderConfirmation()
//   - delivery alerts (rider nearby / arrived)     triggerOrderEvent() from tracking.service.js
//   - missed call support: SMS + call back with the latest order status   handleMissedCall()
//   - customer care IVR menu for inbound calls     carePrompt()/careInput()/careResult()
//
// How it talks to Exotel: we start an outbound call with the Calls/connect API, pointed at an
// Exotel call flow (built once in the Exotel dashboard, see README "IVR"). The flow's Greeting
// applets fetch what to say from our /ivr/exotel/<token>/prompt URL (plain text, read out by
// Exotel's text-to-speech), and its Passthru applets send key presses to our webhooks. Every call
// is recorded in IvrCall. With no provider configured, calls are recorded as 'simulated' instead
// of being placed, so everything else keeps working in development.

const AUTO_CALL_EVENTS = ['accepted', 'out_for_delivery', 'delivery_failed', 'delivered', 'cancelled', 'rider_nearby', 'rider_arrived'];
const DEFAULT_AUTO_CALL_EVENTS = 'out_for_delivery,delivery_failed,rider_arrived';
const DELIVERY_ALERT_EVENTS = ['rider_nearby', 'rider_arrived'];
const CUSTOMER_CANCELLABLE = ['placed', 'accepted', 'picking', 'partially_picked'];

// ---- Settings -------------------------------------------------------------------------------

async function ivrConfig() {
  // 'none' (saved when every event is deselected) filters out to an empty list below.
  const autoEvents = (await getSetting('ivrAutoCallEvents', 'IVR_AUTO_CALL_EVENTS')) ?? DEFAULT_AUTO_CALL_EVENTS;
  const codAbove = await getSetting('ivrCodConfirmAbove', 'IVR_COD_CONFIRM_ABOVE');
  return {
    provider: (await getSetting('ivrProvider', 'IVR_PROVIDER')) || 'none',
    sid: await getSetting('exotelSid', 'EXOTEL_SID'),
    apiKey: await getSetting('exotelApiKey', 'EXOTEL_API_KEY'),
    apiToken: await getSetting('exotelApiToken', 'EXOTEL_API_TOKEN'),
    // api.exotel.com (Singapore) or api.in.exotel.com (Mumbai) — or a full http(s) URL.
    subdomain: (await getSetting('exotelSubdomain', 'EXOTEL_SUBDOMAIN')) || 'api.exotel.com',
    callerId: await getSetting('exotelCallerId', 'EXOTEL_CALLER_ID'),
    messageAppId: await getSetting('exotelMessageAppId', 'EXOTEL_MESSAGE_APP_ID'),
    confirmAppId: await getSetting('exotelConfirmAppId', 'EXOTEL_CONFIRM_APP_ID'),
    autoEvents: String(autoEvents).split(',').map((e) => e.trim()).filter((e) => AUTO_CALL_EVENTS.includes(e)),
    // blank = no confirmation calls; 0 = every COD order; N = COD orders of ₹N or more
    codConfirmAbove: codAbove === null || codAbove === undefined || codAbove === '' ? null : Number(codAbove),
    missedCallCallback: ((await getSetting('ivrMissedCallCallback', 'IVR_MISSED_CALL_CALLBACK')) ?? 'true') !== 'false',
    baseUrl: ((await getSetting('publicBaseUrl', 'PUBLIC_BASE_URL')) || '').replace(/\/+$/, ''),
  };
}

// Secret path segment for the webhooks Exotel calls (it doesn't sign its requests). Generated
// once and stored as a setting; shown to the admin with the ready-made webhook URLs.
async function webhookToken() {
  let token = await getSetting('ivrWebhookToken', 'IVR_WEBHOOK_TOKEN');
  if (!token) {
    token = crypto.randomBytes(18).toString('base64url');
    await Setting.findOneAndUpdate({ key: 'ivrWebhookToken' }, { value: token }, { upsert: true });
    invalidateSettingsCache();
  }
  return token;
}

async function webhookUrls(baseUrl) {
  const token = await webhookToken();
  const root = `${baseUrl}/api/v1/ivr/exotel/${token}`;
  return {
    prompt: `${root}/prompt`,
    input: `${root}/input`,
    status: `${root}/status`,
    missedCall: `${root}/missed-call`,
    carePrompt: `${root}/care/prompt`,
    careInput: `${root}/care/input`,
    careResult: `${root}/care/result`,
  };
}

// ---- Messages -------------------------------------------------------------------------------

// "GRV-MFX1AB2C-4043" -> "4 0 4 3", so text-to-speech reads it digit by digit.
const spokenRef = (orderNumber) => String(orderNumber || '').slice(-4).split('').join(' ');
const firstName = (name) => (name ? String(name).trim().split(/\s+/)[0] : 'there');

function eventMessage(event, order, user, extra = {}) {
  const ref = spokenRef(order.orderNumber);
  const eta = extra.etaMinutes ? `about ${extra.etaMinutes} minutes` : 'a few minutes';
  const hello = `Hello ${firstName(user?.name)}, this is Grovio.`;
  switch (event) {
    case 'accepted': return `${hello} Your order ending ${ref} has been confirmed by the store and is being packed.`;
    case 'out_for_delivery': return `${hello} Your order ending ${ref} is out for delivery and should reach you in ${eta}. Please keep your delivery PIN ready.`;
    case 'delivery_failed': return `${hello} We could not deliver your order ending ${ref}. Our team will contact you shortly.`;
    case 'delivered': return `${hello} Your order ending ${ref} has been delivered. Thank you for shopping with us.`;
    case 'cancelled': return `${hello} Your order ending ${ref} has been cancelled. Any amount paid will be refunded to your Grovio wallet.`;
    case 'rider_nearby': return `${hello} Your delivery partner is ${eta} away with order ending ${ref}. Please keep your delivery PIN ready.`;
    case 'rider_arrived': return `${hello} Your delivery partner has arrived with order ending ${ref}. Please collect your order.`;
    default: return `${hello} There is an update on your order ending ${ref}.`;
  }
}

const STATUS_WORDS = {
  placed: 'waiting for the store to confirm it',
  accepted: 'confirmed and will be packed shortly',
  picking: 'being packed',
  partially_picked: 'being packed',
  packed: 'packed and waiting for a delivery partner',
  assigned: 'packed, and a delivery partner is on the way to collect it',
  picked_up: 'with the delivery partner',
  out_for_delivery: 'out for delivery',
  delivered: 'delivered',
  delivery_failed: 'not delivered yet. Our team will contact you',
  cancelled: 'cancelled',
  returned: 'returned',
  rejected: 'not accepted by the store',
};

function statusSentence(order) {
  if (!order) return 'We could not find any recent order for this phone number.';
  return `Your latest order, ending ${spokenRef(order.orderNumber)}, is ${STATUS_WORDS[order.orderStatus] || order.orderStatus.replace(/_/g, ' ')}.`;
}

const RESULT_MESSAGES = {
  confirmed: 'Thank you. Your order is confirmed and will be delivered soon. Goodbye.',
  declined: 'Your order has been cancelled. Goodbye.',
  too_late: 'Your order is already being processed, so it could not be cancelled on this call. Our team will contact you. Goodbye.',
  invalid: 'Sorry, we did not get a valid choice. Our team may call you again. Goodbye.',
  callback_requested: 'Thank you. Our support team will call you back shortly. Goodbye.',
};

// ---- Placing calls --------------------------------------------------------------------------

// 10-digit Indian numbers are stored without a country code; Exotel wants E.164 or 0-prefixed.
function toDialable(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return phone;
}
const last10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

function exotelBase(cfg) {
  return /^https?:\/\//.test(cfg.subdomain) ? cfg.subdomain.replace(/\/+$/, '') : `https://${cfg.subdomain}`;
}

// Records the call and places it (or simulates it). Never throws — a failed call is recorded
// with status 'failed' and the error. Returns the IvrCall.
async function placeCall({ type, order = null, user = null, phone, event = null, message }) {
  const cfg = await ivrConfig();
  const call = await IvrCall.create({
    type,
    direction: 'outbound',
    order: order?._id || null,
    user: user?._id || null,
    phone,
    event,
    message,
    provider: cfg.provider === 'exotel' ? 'exotel' : 'simulated',
    status: cfg.provider === 'exotel' ? 'queued' : 'simulated',
  });

  if (cfg.provider !== 'exotel') {
    console.log(`[IVR simulated] ${type}${event ? ` (${event})` : ''} -> ${phone}: ${message}`);
    return call;
  }

  try {
    const appId = type === 'order_confirmation' ? cfg.confirmAppId : cfg.messageAppId;
    const missing = ['sid', 'apiKey', 'apiToken', 'callerId'].filter((k) => !cfg[k]);
    if (!appId) missing.push(type === 'order_confirmation' ? 'exotelConfirmAppId' : 'exotelMessageAppId');
    if (!cfg.baseUrl) missing.push('publicBaseUrl');
    if (missing.length) throw new Error(`Exotel is not fully configured (missing: ${missing.join(', ')})`);

    const urls = await webhookUrls(cfg.baseUrl);
    const body = new URLSearchParams({
      From: toDialable(phone),
      CallerId: cfg.callerId,
      Url: `http://my.exotel.com/${cfg.sid}/exoml/start_voice/${appId}`,
      CallType: 'trans',
      TimeLimit: '300',
      TimeOut: '30',
      CustomField: call.id,
      StatusCallback: urls.status,
      'StatusCallbackEvents[0]': 'terminal',
      StatusCallbackContentType: 'application/json',
    });
    const res = await fetch(`${exotelBase(cfg)}/v1/Accounts/${cfg.sid}/Calls/connect.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.RestException?.Message || `Exotel HTTP ${res.status}`);

    call.providerCallId = json?.Call?.Sid || null;
    call.status = String(json?.Call?.Status || 'queued').toLowerCase() === 'in-progress' ? 'in-progress' : 'queued';
  } catch (err) {
    call.status = 'failed';
    call.error = err.message;
    console.error(`IVR call ${call.id} failed:`, err.message);
  }
  await call.save();
  return call;
}

// Automatic call for an order event (status change, or 'rider_nearby' / 'rider_arrived' from the
// tracking geofences), if that event is switched on in the IVR settings. One call per order+event.
async function triggerOrderEvent(order, event, extra = {}) {
  const cfg = await ivrConfig();
  if (!cfg.autoEvents.includes(event)) return null;
  if (await IvrCall.exists({ order: order._id, event })) return null;

  const user = await User.findById(order.customer).select('name phone');
  if (!user?.phone) return null;

  let etaMinutes = extra.etaMinutes;
  if (!etaMinutes && ['out_for_delivery', 'rider_nearby'].includes(event)) {
    try {
      const full = await Order.findById(order._id).populate('store', 'name lat lng').populate('address', 'lat lng');
      etaMinutes = (await require('./tracking.service').trackingSnapshot(full)).eta?.etaMinutes;
    } catch { /* ETA is optional in the message */ }
  }

  return placeCall({
    type: DELIVERY_ALERT_EVENTS.includes(event) ? 'delivery_alert' : 'status_update',
    order,
    user,
    phone: user.phone,
    event,
    message: eventMessage(event, order, user, { etaMinutes }),
  });
}

// COD confirmation call right after checkout, when ivrCodConfirmAbove is set and the order
// qualifies (or always, with force — an admin asking for one). The customer presses 1 (confirm)
// or 2 (cancel) — see handleInput().
async function requestOrderConfirmation(order, { force = false } = {}) {
  const cfg = await ivrConfig();
  if (order.paymentMethod !== 'COD') return null;
  if (!force && (cfg.codConfirmAbove === null || Number(order.grandTotal) < cfg.codConfirmAbove)) return null;
  const user = await User.findById(order.customer).select('name phone');
  if (!user?.phone) return null;

  await Order.updateOne({ _id: order._id }, { $set: { ivrConfirmation: 'pending' } });
  order.ivrConfirmation = 'pending';
  return placeCall({
    type: 'order_confirmation',
    order,
    user,
    phone: user.phone,
    event: 'order_confirmation',
    message: `Hello ${firstName(user.name)}, this is Grovio. You have placed a cash on delivery order of ${Math.round(order.grandTotal)} rupees, ending ${spokenRef(order.orderNumber)}. Press 1 to confirm the order. Press 2 to cancel it.`,
  });
}

// Manual "call the customer with this order's status" from the admin order screen.
async function callOrderStatus(order) {
  const user = await User.findById(order.customer).select('name phone');
  if (!user?.phone) return null;
  return placeCall({
    type: 'status_update', order, user, phone: user.phone, event: 'manual',
    message: `Hello ${firstName(user.name)}, this is Grovio. ${statusSentence(order)} Goodbye.`,
  });
}

// ---- Webhooks (Exotel -> us) ----------------------------------------------------------------

const digitsOf = (v) => String(v ?? '').replace(/\D/g, '');

async function findCall({ CustomField, CallSid }) {
  if (CustomField && /^[a-f\d]{24}$/i.test(CustomField)) {
    const byId = await IvrCall.findById(CustomField);
    if (byId) return byId;
  }
  return CallSid ? IvrCall.findOne({ providerCallId: CallSid }) : null;
}

// Greeting applet text. stage=main: the call's message; stage=result: what happened after input.
async function prompt(params) {
  const call = await findCall(params);
  if (!call) return 'Sorry, this call could not be identified. Goodbye.';
  if (params.CallSid && !call.providerCallId) {
    call.providerCallId = params.CallSid;
    await call.save();
  }
  if (params.stage === 'result') return RESULT_MESSAGES[call.outcome] || RESULT_MESSAGES.invalid;
  return call.message || 'Hello, this is Grovio.';
}

// Passthru after the Gather on the confirmation flow. 1 = confirm, 2 = cancel.
async function handleInput(params) {
  const call = await findCall(params);
  if (!call) return { ok: false };
  const key = digitsOf(params.digits).slice(0, 1);
  call.dtmf = key || null;

  if (call.type === 'order_confirmation' && call.order) {
    const order = await Order.findById(call.order);
    if (key === '1') {
      call.outcome = 'confirmed';
      if (order) { order.ivrConfirmation = 'confirmed'; await order.save(); }
    } else if (key === '2') {
      if (order && CUSTOMER_CANCELLABLE.includes(order.orderStatus)) {
        order.ivrConfirmation = 'declined';
        order.cancelReason = 'Cancelled by customer on confirmation call';
        await order.save();
        await require('./order.service').transitionOrder({ order, toStatus: 'cancelled', changedBy: null, note: order.cancelReason });
        call.outcome = 'declined';
      } else {
        call.outcome = 'too_late';
      }
    } else {
      call.outcome = 'invalid';
    }
  }
  await call.save();
  return { ok: true, outcome: call.outcome };
}

const STATUS_MAP = { completed: 'completed', failed: 'failed', busy: 'busy', 'no-answer': 'no-answer', 'in-progress': 'in-progress', ringing: 'ringing', queued: 'queued' };

// StatusCallback at the end of a call.
async function handleStatus(params) {
  const call = await findCall(params);
  if (!call) return;
  const status = STATUS_MAP[String(params.Status || '').toLowerCase()];
  if (status) call.status = status;
  const duration = Number(params.ConversationDuration ?? params.Duration ?? params.DialCallDuration);
  if (Number.isFinite(duration)) call.durationSec = duration;
  if (params.CallSid && !call.providerCallId) call.providerCallId = params.CallSid;
  await call.save();

  // Confirmation call that ended without a choice.
  if (call.type === 'order_confirmation' && call.order && !['confirmed', 'declined', 'too_late'].includes(call.outcome) && status && status !== 'in-progress') {
    await Order.updateOne({ _id: call.order, ivrConfirmation: 'pending' }, { $set: { ivrConfirmation: 'no_answer' } });
  }
}

async function customerByPhone(phone) {
  const ten = last10(phone);
  if (ten.length !== 10) return null;
  return User.findOne({ role: 'customer', phone: { $in: [ten, `+91${ten}`, `91${ten}`, `0${ten}`] } }).select('name phone');
}

async function latestOrder(userId) {
  if (!userId) return null;
  return Order.findOne({ customer: userId }).sort({ createdAt: -1 });
}

// Passthru on the missed-call number: record it, SMS the latest order status and (optionally)
// call back and read it out. Runs the SMS/call in the background so Exotel gets a fast 200.
async function handleMissedCall(params) {
  const from = params.From || params.CallFrom;
  if (!from) return;
  const user = await customerByPhone(from);
  const order = await latestOrder(user?._id);
  await IvrCall.create({
    type: 'missed_call',
    direction: 'inbound',
    user: user?._id || null,
    order: order?._id || null,
    phone: from,
    provider: 'exotel',
    providerCallId: params.CallSid || null,
    status: 'completed',
    outcome: user ? 'status_sent' : 'unknown_caller',
  });
  if (!user) return;

  const sentence = statusSentence(order);
  (async () => {
    await sendSms(user.phone, `Grovio: ${sentence.replace(/(\d) (?=\d)/g, '$1')}`).catch(() => {});
    const cfg = await ivrConfig();
    if (cfg.missedCallCallback) {
      await placeCall({ type: 'missed_call_callback', order, user, phone: user.phone, event: 'missed_call', message: `Hello ${firstName(user.name)}, this is Grovio returning your call. ${sentence} Goodbye.` });
    }
  })().catch((err) => console.error('Missed call follow-up failed:', err.message));
}

// ---- Customer care IVR (inbound) ------------------------------------------------------------

async function careCall(params) {
  let call = params.CallSid ? await IvrCall.findOne({ providerCallId: params.CallSid, type: 'customer_care' }) : null;
  if (!call) {
    const from = params.From || params.CallFrom || 'unknown';
    const user = await customerByPhone(from);
    const order = await latestOrder(user?._id);
    call = await IvrCall.create({
      type: 'customer_care', direction: 'inbound', user: user?._id || null, order: order?._id || null,
      phone: from, provider: 'exotel', providerCallId: params.CallSid || null, status: 'in-progress',
    });
  }
  return call;
}

async function carePrompt(params) {
  await careCall(params);
  return 'Welcome to Grovio customer care. Press 1 to hear the status of your latest order. Press 2 to speak to our support team. Press 3 to request a call back.';
}

// Passthru after the care menu's Gather. Returns 302 for "connect to an agent" (the flow's
// failure branch goes to a Connect applet), 200 otherwise.
async function careInput(params) {
  const call = await careCall(params);
  const key = digitsOf(params.digits).slice(0, 1);
  call.dtmf = key || null;
  if (key === '1') call.outcome = 'status_read';
  else if (key === '2') call.outcome = 'agent_requested';
  else if (key === '3') {
    call.outcome = 'callback_requested';
    if (call.user) {
      await SupportTicket.create({
        user: call.user,
        subject: 'Call back requested (IVR)',
        message: `Customer asked for a call back from the IVR menu on ${call.phone}.${call.order ? ` Latest order: ${call.order}.` : ''}`,
      });
    }
  } else call.outcome = 'invalid';
  await call.save();
  return { connectAgent: call.outcome === 'agent_requested' };
}

async function careResult(params) {
  const call = await careCall(params);
  if (call.outcome === 'status_read') {
    const order = call.order ? await Order.findById(call.order) : null;
    return `${statusSentence(order)} Thank you for calling Grovio. Goodbye.`;
  }
  return RESULT_MESSAGES[call.outcome] || RESULT_MESSAGES.invalid;
}

module.exports = {
  AUTO_CALL_EVENTS,
  ivrConfig,
  webhookToken,
  webhookUrls,
  placeCall,
  triggerOrderEvent,
  requestOrderConfirmation,
  callOrderStatus,
  eventMessage,
  prompt,
  handleInput,
  handleStatus,
  handleMissedCall,
  carePrompt,
  careInput,
  careResult,
};
