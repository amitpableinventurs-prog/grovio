const { getSetting } = require('./settings.service');

// Sends `message` to `phone` via whichever provider is configured in Admin > Settings >
// Integrations (falling back to .env for local dev): apitxt (OTP only) or MSG91. Twilio SMS was
// removed — a leftover smsProvider 'twilio' setting counts as unknown_provider. Returns
// { sent, reason? } instead of throwing — the caller (otp.service.js) decides how to treat "not configured" (fall back to the
// existing dev-mode debugOtp behavior) vs. a configured provider actually failing (surface a real
// error to the customer).
async function sendSms(phone, message, { otpCode } = {}) {
  const provider = await getSetting('smsProvider', 'SMS_PROVIDER');
  if (!provider || provider === 'none') return { sent: false, reason: 'not_configured' };

  try {
    if (provider === 'apitxt') return await sendViaApitxt(phone, otpCode);
    if (provider === 'msg91') return await sendViaMsg91(phone, message, otpCode);
    return { sent: false, reason: 'unknown_provider' };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

// apitxt.com Unified OTP API (https://apitxt.com/developer/otp-api): one endpoint, `/api/sendOTP`.
// apitxt only DELIVERS an OTP — we generate it (otp.service.js) and pass it as `otp`; it fills the
// {otp} placeholder of the template configured in the apitxt dashboard. There is no verify
// endpoint, so verification stays local. It can't send free-form text, hence the otpCode guard.
// The auth key lives in Admin > Settings (smsApiKey) or APITXT_AUTH_KEY — never in the apps.
// Optional: smsTemplateId / APITXT_TEMPLATE_ID (your apitxt SMS template id),
// APITXT_CHANNEL (sms | whatsapp | voice, default sms), APITXT_BASE_URL.
async function sendViaApitxt(phone, otpCode) {
  const authKey = await getSetting('smsApiKey', 'APITXT_AUTH_KEY');
  if (!authKey) return { sent: false, reason: 'not_configured' };
  if (!otpCode) return { sent: false, reason: 'apitxt_supports_otp_only' };

  const baseUrl = (process.env.APITXT_BASE_URL || 'https://apitxt.com').replace(/\/+$/, '');
  const templateId = await getSetting('smsTemplateId', 'APITXT_TEMPLATE_ID');
  const channel = process.env.APITXT_CHANNEL || 'sms';

  // POST (form-encoded) keeps the key out of URLs and proxy/access logs.
  const body = new URLSearchParams({
    authkey: authKey,
    mobile: toE164(phone).replace(/^\+/, ''), // e.g. 919999999999; apitxt wants the country code
    otp: String(otpCode),
    channel,
  });
  if (templateId && channel === 'sms') body.set('template_id', String(templateId));

  const res = await fetch(`${baseUrl}/api/sendOTP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  // apitxt reports some failures with HTTP 200 and { status: 'error' }, so res.ok isn't enough.
  const json = await res.json().catch(() => null);
  if (res.ok && json?.status === 'success') return { sent: true, requestId: json.data?.request_id };
  return { sent: false, reason: `apitxt_${res.status}_${json?.status || 'bad_response'}${json?.message ? `: ${json.message}` : ''}` };
}

// MSG91's Flow API sends a pre-approved DLT transactional template (mandatory for sending
// transactional SMS in India) with variables filled in. `smsTemplateId` is that template's flow
// ID from the MSG91 dashboard — its approved template must contain a variable named `OTP` for
// this to fill in correctly; adjust the variable key below if your template uses a different name.
async function sendViaMsg91(phone, message, otpCode) {
  const authKey = await getSetting('smsApiKey', 'MSG91_AUTH_KEY');
  const senderId = await getSetting('smsSenderId', 'MSG91_SENDER_ID');
  const templateId = await getSetting('smsTemplateId', 'MSG91_TEMPLATE_ID');
  if (!authKey || !senderId || !templateId) return { sent: false, reason: 'not_configured' };

  const res = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: authKey },
    body: JSON.stringify({
      flow_id: templateId,
      sender: senderId,
      mobiles: phone.replace(/^\+/, ''),
      OTP: otpCode || message,
    }),
  });

  if (!res.ok) return { sent: false, reason: `msg91_http_${res.status}` };
  return { sent: true };
}

// A non-OTP text (e.g. an SOS alert). MSG91 can only send DLT-approved templates, so it needs its
// own template: `msg91TemplateSetting` names the setting holding that flow ID, and `vars` fill its
// variables. Without that template, MSG91 returns not_configured rather than misusing the OTP one.
// apitxt only delivers OTPs, so it can't send these.
async function sendTextSms(phone, message, { msg91TemplateSetting, vars = {} } = {}) {
  const provider = await getSetting('smsProvider', 'SMS_PROVIDER');
  if (!provider || provider === 'none') return { sent: false, reason: 'not_configured' };
  if (provider === 'apitxt') return { sent: false, reason: 'apitxt_supports_otp_only' };

  try {
    if (provider === 'msg91') {
      const authKey = await getSetting('smsApiKey', 'MSG91_AUTH_KEY');
      const senderId = await getSetting('smsSenderId', 'MSG91_SENDER_ID');
      const templateId = msg91TemplateSetting ? await getSetting(msg91TemplateSetting) : null;
      if (!authKey || !senderId || !templateId) return { sent: false, reason: 'not_configured' };
      const res = await fetch('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: authKey },
        body: JSON.stringify({ flow_id: templateId, sender: senderId, mobiles: toE164(phone).replace(/^\+/, ''), ...vars }),
      });
      if (!res.ok) return { sent: false, reason: `msg91_http_${res.status}` };
      return { sent: true };
    }
    return { sent: false, reason: 'unknown_provider' };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

// Phones are stored as '9876543210' or '+919876543210'; providers want E.164.
function toE164(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

module.exports = { sendSms, sendTextSms, toE164 };
