const crypto = require('crypto');
const QRCode = require('qrcode');
const { HubDisplay, Order } = require('../models');
const { getSetting } = require('./settings.service');

// Hub Center screens (models/hubDisplay.model.js) and the Delivery Boy check-in they enable.
//
//   Screen at /hub-display  --(X-Hub-Display-Key)-->  GET /hub-display/checkin-qr
//     shows a QR of  <PUBLIC_BASE_URL>/hub-checkin/?t=<checkinToken>
//   Delivery app scans it  -->  POST /delivery/hub/checkin { code }
//     token -> screen -> store (the hub); the partner's DeliveryProfile.hubCheckin is set for
//     HUB_CHECKIN_MINUTES, which is what /delivery/hub/orders and .../claim require.
//
// The token is single-use: it has no timer, but the first successful check-in consumes it and
// swaps in a new one, and the screen is told over its socket ('hub:qr') to show the new QR. So a
// photo of the QR stops working as soon as anyone has scanned it.
//
// The QR is only proof of presence, never an authorization by itself: the scan is made with the
// partner's own access token, and everything it unlocks is checked server-side against their role
// and the hub the token maps to.

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

// Origin used in pairing links and QR URLs: the "Public server URL" setting / PUBLIC_BASE_URL
// (set it in production — behind a proxy the request's own protocol/host may be the internal one).
async function publicBaseUrl(req) {
  const configured = ((await getSetting('publicBaseUrl', 'PUBLIC_BASE_URL')) || '').replace(/\/+$/, '');
  return configured || `${req.protocol}://${req.get('host')}`;
}

// Returns the non-revoked screen for a device key (with its store populated), or null.
async function findDisplayByKey(key) {
  if (!key) return null;
  return HubDisplay.findOne({ keyHash: hashKey(key), revokedAt: null }).populate('store', 'name address status');
}

// Returns the screen's current check-in token, issuing the first one if it has none yet. It only
// changes when a check-in consumes it (consumeCheckinToken below).
async function getCheckinToken(displayId) {
  const display = await HubDisplay.findById(displayId).select('+checkinToken');
  if (!display || display.revokedAt) return null;
  if (display.checkinToken) return display.checkinToken;

  // Only set it if still empty, so two tabs loading at once end up showing the same token.
  await HubDisplay.updateOne(
    { _id: displayId, revokedAt: null, checkinToken: null },
    { $set: { checkinToken: generateCheckinToken(), checkinTokenIssuedAt: new Date() } },
  );
  const current = await HubDisplay.findById(displayId).select('+checkinToken');
  return current && !current.revokedAt ? current.checkinToken : null;
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

// Uses up a scanned check-in token: swaps in a new one and tells the screen to show it. Returns the
// (non-revoked) screen it belonged to, store populated — or null if the token is unknown or was
// already used. Atomic, so when two partners scan the same QR at once only the first gets in.
async function consumeCheckinToken(token) {
  if (!token) return null;
  const display = await HubDisplay.findOneAndUpdate(
    { revokedAt: null, checkinToken: token },
    { $set: { checkinToken: generateCheckinToken(), checkinTokenIssuedAt: new Date() } },
  ).populate('store', 'name address lat lng status');
  if (!display) return null;

  const { emitToRooms, ROOMS } = require('../sockets');
  emitToRooms([ROOMS.display(display.id)], 'hub:qr', { reason: 'scanned' });
  return display;
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
  CHECKIN_MINUTES,
  hashKey,
  generateDisplayKey,
  publicBaseUrl,
  findDisplayByKey,
  getCheckinToken,
  checkinUrl,
  qrSvg,
  extractCheckinToken,
  consumeCheckinToken,
  checkinExpiry,
  activeCheckinStoreId,
  buildBoard,
};
