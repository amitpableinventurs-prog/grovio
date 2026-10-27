const crypto = require('crypto');

// The token in an order's QR on the hub screen (order.model.js#hubPickupToken). 40 hex characters,
// so a raw scanned token can't be mistaken for a hub check-in token (base64url, 24 characters) —
// see hubDisplay.service.js#parseHubCode.
const HUB_PICKUP_TOKEN_RE = /^[a-f0-9]{40}$/;

function generateHubPickupToken() {
  return crypto.randomBytes(20).toString('hex');
}

module.exports = { HUB_PICKUP_TOKEN_RE, generateHubPickupToken };
