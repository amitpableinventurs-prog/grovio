const crypto = require('crypto');
const QRCode = require('qrcode');
const { HubDisplay, Order } = require('../models');

// Hub Center screens (models/hubDisplay.model.js) and the Delivery Boy check-in they enable.
//
//   Screen at /hub-display  --(X-Hub-Display-Key)-->  GET /hub-display/checkin-qr
//     shows a QR of  <PUBLIC_BASE_URL>/hub-checkin/?t=<checkinToken>, re-fetched every rotation
//   Delivery app scans it  -->  POST /delivery/hub/checkin { code }
//     token -> screen -> store (the hub); the partner's DeliveryProfile.hubCheckin is set for
//     HUB_CHECKIN_MINUTES, which is what /delivery/hub/orders and .../claim require.
//
// The QR is only proof of presence, never an authorization by itself: the scan is made with the
// partner's own access token, and everything it unlocks is checked server-side against their role
// and the hub the token maps to.

const QR_ROTATE_SECONDS = Number(process.env.HUB_QR_ROTATE_SECONDS || 30);
// Extra validity past the rotation, so a scan started just before the screen changed still works.
const QR_GRACE_SECONDS = Number(process.env.HUB_QR_GRACE_SECONDS || 15);
const CHECKIN_MINUTES = Number(process.env.HUB_CHECKIN_MINUTES || 30);

// Orders a hub screen lists: still being picked/packed, or packed and waiting for a rider.
const PREPARING_STATUSES = ['accepted', 'picking', 'partially_picked'];
const READY_STATUSES = ['packed', 'assigned'];

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function generateDisplayKey() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCheckinToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// Origin used in pairing links and QR URLs. Set PUBLIC_BASE_URL in production (behind a proxy the
// request's own protocol/host may be the internal one).
function publicBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

// Returns the non-revoked screen for a device key (with its store populated), or null.
async function findDisplayByKey(key) {
  if (!key) return null;
  return HubDisplay.findOne({ keyHash: hashKey(key), revokedAt: null }).populate('store', 'name address status');
}

// Returns the screen's live check-in token, rotating it once the current one is older than
// QR_ROTATE_SECONDS. Every screen (and every open tab on it) shares one current token, so
// re-fetching early doesn't churn it. `refreshAt` is when the screen should fetch again.
async function getOrRotateCheckinToken(displayId) {
  const TOKEN_FIELDS = '+checkinToken +checkinTokenIssuedAt +checkinTokenExpiresAt +prevCheckinToken +prevCheckinTokenExpiresAt';
  const toResult = (d) => ({
    token: d.checkinToken,
    refreshAt: new Date(d.checkinTokenIssuedAt.getTime() + QR_ROTATE_SECONDS * 1000),
  });

  const display = await HubDisplay.findById(displayId).select(TOKEN_FIELDS);
  if (!display || display.revokedAt) return null;

  const now = Date.now();
  const age = display.checkinTokenIssuedAt ? now - display.checkinTokenIssuedAt.getTime() : Infinity;
  if (display.checkinToken && age < QR_ROTATE_SECONDS * 1000) return toResult(display);

  // Conditional on the token we just read, so two tabs rotating at once can't both win and leave
  // one of them showing a token that was overwritten before anyone could scan it.
  const rotated = await HubDisplay.findOneAndUpdate(
    { _id: displayId, revokedAt: null, checkinTokenIssuedAt: display.checkinTokenIssuedAt },
    {
      $set: {
        prevCheckinToken: display.checkinToken,
        prevCheckinTokenExpiresAt: display.checkinTokenExpiresAt,
        checkinToken: generateCheckinToken(),
        checkinTokenIssuedAt: new Date(now),
        checkinTokenExpiresAt: new Date(now + (QR_ROTATE_SECONDS + QR_GRACE_SECONDS) * 1000),
      },
    },
    { new: true },
  ).select(TOKEN_FIELDS);
  if (rotated) return toResult(rotated);

  // Lost the race — someone else rotated it; use theirs.
  const current = await HubDisplay.findById(displayId).select(TOKEN_FIELDS);
  return current && !current.revokedAt && current.checkinToken ? toResult(current) : null;
}

function checkinUrl(baseUrl, token) {
  return `${baseUrl}/hub-checkin/?t=${encodeURIComponent(token)}`;
}

function qrSvg(text) {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
}

// The delivery app may send the whole scanned URL or just the token — accept both.
function extractCheckinToken(code) {
  const raw = String(code || '').trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    try {
      return new URL(raw).searchParams.get('t');
    } catch {
      return null;
    }
  }
  return raw;
}

// Resolves a scanned check-in token to its (non-revoked) screen, or null if it's unknown/expired.
async function findDisplayByCheckinToken(token) {
  if (!token) return null;
  const now = new Date();
  return HubDisplay.findOne({
    revokedAt: null,
    $or: [
      { checkinToken: token, checkinTokenExpiresAt: { $gt: now } },
      { prevCheckinToken: token, prevCheckinTokenExpiresAt: { $gt: now } },
    ],
  }).populate('store', 'name address lat lng status');
}

function checkinExpiry() {
  return new Date(Date.now() + CHECKIN_MINUTES * 60 * 1000);
}

// The hub a delivery profile is currently checked in at, or null if never / expired.
function activeCheckinStoreId(profile) {
  const c = profile?.hubCheckin;
  if (!c?.store || !c.expiresAt || c.expiresAt < new Date()) return null;
  return c.store.toString();
}

const firstName = (name) => (name ? String(name).trim().split(/\s+/)[0] : null);

function readySince(order) {
  const packed = [...(order.statusLogs || [])].reverse().find((l) => l.status === 'packed');
  return packed?.createdAt || order.updatedAt;
}

// What the hub screen shows. Deliberately no customer name/phone/address or amounts — the screen
// is on a wall for anyone at the hub to see.
async function buildBoard(storeId) {
  const orders = await Order.find({ store: storeId, orderStatus: { $in: [...PREPARING_STATUSES, ...READY_STATUSES] } })
    .select('orderNumber orderStatus items.qty pickTasks.status delivery deliveryAcceptedAt arrivedAtPickupAt statusLogs placedAt updatedAt')
    .populate('delivery', 'name')
    .sort({ placedAt: 1 })
    .limit(200);

  const toCard = (o) => ({
    orderId: o._id,
    orderNumber: o.orderNumber,
    orderStatus: o.orderStatus,
    itemCount: (o.items || []).reduce((sum, i) => sum + (i.qty || 0), 0),
    pickers: { total: o.pickTasks.length, done: o.pickTasks.filter((t) => t.status === 'completed').length },
    placedAt: o.placedAt,
    readySince: READY_STATUSES.includes(o.orderStatus) ? readySince(o) : null,
    rider: o.delivery ? { name: firstName(o.delivery.name), arrived: !!o.arrivedAtPickupAt } : null,
  });

  return {
    preparing: orders.filter((o) => PREPARING_STATUSES.includes(o.orderStatus)).map(toCard),
    ready: orders.filter((o) => READY_STATUSES.includes(o.orderStatus)).map(toCard)
      .sort((a, b) => new Date(a.readySince) - new Date(b.readySince)),
  };
}

module.exports = {
  QR_ROTATE_SECONDS,
  CHECKIN_MINUTES,
  hashKey,
  generateDisplayKey,
  publicBaseUrl,
  findDisplayByKey,
  getOrRotateCheckinToken,
  checkinUrl,
  qrSvg,
  extractCheckinToken,
  findDisplayByCheckinToken,
  checkinExpiry,
  activeCheckinStoreId,
  buildBoard,
};
