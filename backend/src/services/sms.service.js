const { getSetting } = require('./settings.service');

// Sends `message` to `phone` via whichever provider is configured in Admin > Settings >
// Integrations (falling back to .env for local dev). Returns { sent, reason? } instead of
// throwing — the caller (otp.service.js) decides how to treat "not configured" (fall back to the
// existing dev-mode debugOtp behavior) vs. a configured provider actually failing (surface a real
// error to the customer).
async function sendSms(phone, message, { otpCode } = {}) {
  const provider = await getSetting('smsProvider', 'SMS_PROVIDER');
  if (!provider || provider === 'none') return { sent: false, reason: 'not_configured' };

  try {
    if (provider === 'msg91') return await sendViaMsg91(phone, message, otpCode);
    if (provider === 'twilio') return await sendViaTwilio(phone, message);
    return { sent: false, reason: 'unknown_provider' };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
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

// Twilio's standard Messages API — no DLT/template requirement outside India.
async function sendViaTwilio(phone, message) {
  const accountSid = await getSetting('smsApiKey', 'TWILIO_ACCOUNT_SID');
  const authToken = await getSetting('smsApiSecret', 'TWILIO_AUTH_TOKEN');
  const fromNumber = await getSetting('smsSenderId', 'TWILIO_FROM_NUMBER');
  if (!accountSid || !authToken || !fromNumber) return { sent: false, reason: 'not_configured' };

  const body = new URLSearchParams({ To: phone, From: fromNumber, Body: message });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) return { sent: false, reason: `twilio_http_${res.status}` };
  return { sent: true };
}

module.exports = { sendSms };
