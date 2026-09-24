const crypto = require('crypto');
const { Payment } = require('../../models');
const { getSetting } = require('../settings.service');
const ApiError = require('../../utils/apiError');
const { newTransactionId, markPaid, markFailed } = require('./index');

// PhonePe Payment Gateway — Standard Checkout (v2 API, OAuth client credentials). Flow:
//   1. POST /payments/phonepe/create -> we create a PhonePe checkout order and return its
//      redirectUrl; the customer web app sends the customer there (UPI apps, cards, netbanking).
//   2. PhonePe redirects the customer back to the customer web app's /payment/return page, which
//      calls POST /payments/phonepe/verify — we ask PhonePe for the order status (never trust the
//      redirect itself) and mark the order paid/failed.
//   3. PhonePe's webhook (POST /payments/phonepe/webhook) reports the same outcome server to
//      server, for customers who never come back to the site.

const HOSTS = {
  sandbox: { auth: 'https://api-preprod.phonepe.com/apis/pg-sandbox', pg: 'https://api-preprod.phonepe.com/apis/pg-sandbox' },
  production: { auth: 'https://api.phonepe.com/apis/identity-manager', pg: 'https://api.phonepe.com/apis/pg' },
};

async function phonepeConfig() {
  const clientId = await getSetting('phonepeClientId', 'PHONEPE_CLIENT_ID');
  const clientSecret = await getSetting('phonepeClientSecret', 'PHONEPE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new ApiError(500, 'PhonePe is not configured. Set the client ID and secret in Admin > Settings > Payments.');
  const env = (await getSetting('phonepeEnv', 'PHONEPE_ENV')) === 'production' ? 'production' : 'sandbox';
  return {
    clientId,
    clientSecret,
    clientVersion: (await getSetting('phonepeClientVersion', 'PHONEPE_CLIENT_VERSION')) || '1',
    authBase: process.env.PHONEPE_AUTH_BASE || HOSTS[env].auth,
    pgBase: process.env.PHONEPE_PG_BASE || HOSTS[env].pg,
    webhookUsername: await getSetting('phonepeWebhookUsername', 'PHONEPE_WEBHOOK_USERNAME'),
    webhookPassword: await getSetting('phonepeWebhookPassword', 'PHONEPE_WEBHOOK_PASSWORD'),
  };
}

// OAuth access token, cached until shortly before it expires.
let tokenCache = { key: null, token: null, expiresAt: 0 };
async function accessToken(cfg) {
  const key = `${cfg.authBase}|${cfg.clientId}|${cfg.clientVersion}`;
  if (tokenCache.key === key && tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;

  const res = await fetch(`${cfg.authBase}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_version: String(cfg.clientVersion), client_secret: cfg.clientSecret, grant_type: 'client_credentials' }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new ApiError(502, res.status === 401 || res.status === 400
      ? 'PhonePe rejected our client credentials. Check them in Admin > Settings > Payments.'
      : `PhonePe authorization failed (HTTP ${res.status})`);
  }
  tokenCache = { key, token: json.access_token, expiresAt: json.expires_at ? json.expires_at * 1000 : Date.now() + 15 * 60_000 };
  return json.access_token;
}

async function api(cfg, method, path, body) {
  const res = await fetch(`${cfg.pgBase}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${await accessToken(cfg)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(502, `PhonePe error: ${json.message || json.code || `HTTP ${res.status}`}`);
  return json;
}

async function createPayment({ order, user, redirectUrl }) {
  const cfg = await phonepeConfig();
  const merchantOrderId = newTransactionId();
  const resp = await api(cfg, 'POST', '/checkout/v2/pay', {
    merchantOrderId,
    amount: Math.round(Number(order.grandTotal) * 100),
    expireAfter: 1200,
    metaInfo: { udf1: order._id.toString(), udf2: order.orderNumber },
    paymentFlow: {
      type: 'PG_CHECKOUT',
      message: `Grovio order ${order.orderNumber}`,
      merchantUrls: { redirectUrl },
    },
  });
  if (!resp.redirectUrl) throw new ApiError(502, 'PhonePe did not return a payment page');

  await Payment.create({
    order: order._id,
    user: user._id,
    amount: order.grandTotal,
    method: 'PHONEPE',
    gatewayOrderId: merchantOrderId,
    gatewayPaymentId: resp.orderId || null,
    status: 'created',
  });
  return { redirectUrl: resp.redirectUrl, merchantOrderId };
}

const INSTRUMENTS = { UPI_QR: 'upi', UPI_INTENT: 'upi', UPI_COLLECT: 'upi', CARD: 'card', DEBIT_CARD: 'card', CREDIT_CARD: 'card', NET_BANKING: 'netbanking', NETBANKING: 'netbanking' };

// Applies a PhonePe order state ('COMPLETED' | 'FAILED' | 'PENDING') to our Payment.
async function applyState(payment, data) {
  const state = String(data.state || '').toUpperCase();
  const detail = (data.paymentDetails || [])[0] || {};
  if (state === 'COMPLETED') {
    return markPaid(payment, {
      gatewayPaymentId: detail.transactionId || data.orderId,
      instrument: INSTRUMENTS[String(detail.paymentMode || '').toUpperCase()] || null,
      amount: data.amount !== undefined ? Number(data.amount) / 100 : undefined,
      raw: data,
    });
  }
  if (state === 'FAILED') {
    return markFailed(payment, { gatewayPaymentId: detail.transactionId || data.orderId, reason: data.errorCode || detail.errorCode || 'Payment failed on PhonePe', raw: data });
  }
  return { changed: false }; // PENDING — wait for the webhook / next check
}

// Asks PhonePe for the latest attempt on this order and records the outcome.
async function checkOrderPayment(orderId) {
  const payment = await Payment.findOne({ order: orderId, method: 'PHONEPE' }).sort({ createdAt: -1 });
  if (!payment) throw new ApiError(404, 'No PhonePe payment found for this order');
  if (payment.status === 'paid') return payment;
  const cfg = await phonepeConfig();
  const data = await api(cfg, 'GET', `/checkout/v2/order/${encodeURIComponent(payment.gatewayOrderId)}/status`);
  await applyState(payment, data);
  return payment;
}

// Webhook: PhonePe sends Authorization = SHA256("<username>:<password>") configured on its dashboard.
async function handleWebhook(authorization, body) {
  const cfg = await phonepeConfig();
  if (!cfg.webhookUsername || !cfg.webhookPassword) return { ok: false, reason: 'webhook_not_configured' };
  const expected = crypto.createHash('sha256').update(`${cfg.webhookUsername}:${cfg.webhookPassword}`).digest('hex');
  const given = String(authorization || '').replace(/^SHA256\s+/i, '').trim().toLowerCase();
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return { ok: false, reason: 'bad_signature' };

  const data = body?.payload || {};
  const payment = await Payment.findOne({ method: 'PHONEPE', gatewayOrderId: data.merchantOrderId });
  if (!payment) return { ok: true, ignored: true };
  await applyState(payment, data);
  return { ok: true };
}

module.exports = { createPayment, checkOrderPayment, handleWebhook };
