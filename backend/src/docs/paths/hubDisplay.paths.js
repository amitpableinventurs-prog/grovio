const { envelope, errorResponse } = require('../helpers');

// The Hub Center screen's own API (the /hub-display page) — device-key auth, not a user token.
const paths = {};
const TAG = ['Hub Screen'];
const security = { security: [{ hubDisplayKey: [] }] };
const UNAUTH = errorResponse('Missing, invalid or revoked X-Hub-Display-Key');

const CARD = {
  type: 'object',
  properties: {
    orderId: { type: 'string' }, orderNumber: { type: 'string' }, orderStatus: { type: 'string' }, itemCount: { type: 'integer' },
    pickers: { type: 'object', properties: { total: { type: 'integer' }, done: { type: 'integer' } } },
    placedAt: { type: 'string', format: 'date-time' },
    readySince: { type: 'string', format: 'date-time', nullable: true },
    rider: { type: 'object', nullable: true, properties: { name: { type: 'string', description: 'First name only' }, arrived: { type: 'boolean' } } },
  },
};

paths['/hub-display/board'] = {
  get: {
    tags: TAG, summary: 'This screen\'s hub and its preparing / ready-for-pickup orders (no customer details or amounts)', ...security,
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          display: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
          hub: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, address: { type: 'string' } } },
          preparing: { type: 'array', items: CARD },
          ready: { type: 'array', items: CARD },
          serverTime: { type: 'string', format: 'date-time' },
        },
      }),
      401: UNAUTH,
    },
  },
};
paths['/hub-display/checkin-qr'] = {
  get: {
    tags: TAG, summary: 'Current Delivery Boy check-in QR (SVG markup), rotated every HUB_QR_ROTATE_SECONDS — fetch again at refreshAt', ...security,
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          qrSvg: { type: 'string' }, refreshAt: { type: 'string', format: 'date-time' },
          rotateSeconds: { type: 'integer', example: 30 }, serverTime: { type: 'string', format: 'date-time' },
        },
      }),
      401: UNAUTH,
    },
  },
};

module.exports = paths;
