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
    pickupQr: { type: 'string', nullable: true, description: "Ready orders only: the order's pickup QR (SVG markup) for riders to scan with POST /delivery/hub/scan" },
  },
};

const PICK_ITEM = {
  type: 'object',
  properties: {
    name: { type: 'string', example: 'Tomato' }, variant: { type: 'string', nullable: true, example: '1 kg' },
    qty: { type: 'integer', example: 2 }, pickedQty: { type: 'integer', nullable: true },
    state: { type: 'string', enum: ['to_pick', 'partial', 'picked', 'unavailable', 'substituted'] },
    note: { type: 'string', nullable: true, description: 'Substitution note' },
  },
};
paths['/hub-display/picking-board'] = {
  get: {
    tags: TAG, summary: "The same paired screen as a picker TV at any store (/picker-display): this store's part of every order still being picked. Orders leave it once packed (they're then on the dark store's /hub-display with their QR). Refetch on 'hub:order'.", ...security,
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          display: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
          store: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string', example: 'Fresh Vegetables' }, address: { type: 'string' } } },
          orders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                orderId: { type: 'string' }, orderNumber: { type: 'string' }, placedAt: { type: 'string', format: 'date-time' },
                picker: { type: 'object', properties: { name: { type: 'string', nullable: true, description: 'First name' } } },
                taskStatus: { type: 'string', enum: ['assigned', 'picking', 'completed'], description: "This store's part" },
                accepted: { type: 'boolean' },
                hub: { type: 'object', properties: { name: { type: 'string', description: 'The dark store the order is put together at' }, isThisStore: { type: 'boolean' } } },
                nextStep: { type: 'string', enum: ['pick', 'take_to_hub', 'wait_for_other_stores'] },
                stores: { type: 'object', properties: { total: { type: 'integer' }, done: { type: 'integer' } } },
                items: { type: 'array', items: PICK_ITEM, description: "Only this store's items" },
              },
            },
          },
          serverTime: { type: 'string', format: 'date-time' },
        },
      }),
      401: UNAUTH,
    },
  },
};
paths['/hub-display/board'] = {
  get: {
    tags: TAG, summary: 'This screen\'s hub and its ready-for-pickup orders (no customer details or amounts)', ...security,
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          display: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
          hub: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, address: { type: 'string' } } },
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
    tags: TAG, summary: 'Current Delivery Boy check-in QR (SVG markup). It changes only when a check-in uses it — the screen then gets a hub:qr socket event and fetches it again', ...security,
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          qrSvg: { type: 'string' }, serverTime: { type: 'string', format: 'date-time' },
        },
      }),
      401: UNAUTH,
    },
  },
};

module.exports = paths;
