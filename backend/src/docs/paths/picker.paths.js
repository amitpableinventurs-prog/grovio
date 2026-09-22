const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_404,
  jsonBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

const paths = {};
const TAG = ['Picker'];

paths['/picker/profile'] = {
  get: { tags: TAG, summary: 'Get my picker profile', ...bearer(), responses: { 200: envelope(ref('PickerProfile')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/availability'] = {
  patch: { tags: TAG, summary: 'Toggle online/offline', ...bearer(), requestBody: jsonBody({ isAvailable: { type: 'boolean' } }, ['isAvailable']), responses: { 200: envelope(ref('PickerProfile'), 'Availability updated'), 401: RESPONSES_401 } },
};
paths['/picker/jobs'] = {
  get: { tags: TAG, summary: 'List my assigned pick-lists (jobs) — any order I hold a pickTask on', ...bearer(), parameters: [...PAGE_QS, q('status', "default: accepted,picking,partially_picked,packed")], responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
};
paths['/picker/jobs/{id}'] = {
  get: { tags: TAG, summary: 'Get one job (pick-list) detail', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/jobs/{id}/start'] = {
  post: { tags: TAG, summary: "Mark my own pickTask 'picking' (the order itself is already picking/partially_picked from the moment it was split across pickers)", ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order'), 'Started picking'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/jobs/{id}/items/{itemId}'] = {
  patch: { tags: TAG, summary: 'Mark an item picked / out-of-stock / substituted — no scanning, this is the only way to report an item (only items assigned to me)', ...bearer(), parameters: [idParam(), idParam('itemId', 'Order item subdocument ID')], requestBody: jsonBody({ pickedQty: { type: 'integer' }, isAvailable: { type: 'boolean' }, substituteProductId: { type: 'string' }, substituteNote: { type: 'string' } }), responses: { 200: envelope(ref('OrderItem'), 'Item updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/jobs/{id}/substitutions'] = {
  post: { tags: TAG, summary: 'Record a substitution for an out-of-stock item (notifies the customer; only items assigned to me)', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ itemId: { type: 'string' }, substituteProductId: { type: 'string' }, substituteNote: { type: 'string' } }, ['itemId']), responses: { 200: envelope(ref('OrderItem'), 'Substitution recorded'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/jobs/{id}/complete'] = {
  post: {
    tags: TAG, summary: "Mark MY portion (not the whole order — see pickTasks) picked, packed and ready for pickup. Once every picker on the order has done the same, it rolls up to 'packed' (\"fully ready for pickup\") automatically and a delivery partner is auto-assigned.", ...bearer(), parameters: [idParam()],
    responses: { 200: envelope(ref('Order'), 'Your portion is marked ready for pickup'), 400: errorResponse('You have already completed your portion of this order'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/picker/jobs/{id}/pickup/otp'] = {
  get: {
    tags: TAG,
    summary: 'Get the pickup OTP for MY store to read out to the delivery partner in person when they arrive (auto-generated once a delivery partner is assigned; refreshed here if expired)',
    ...bearer(), parameters: [idParam()],
    responses: { 200: envelope({ type: 'object', properties: { otp: { type: 'string', example: '4821' }, expiresAt: { type: 'string', format: 'date-time' } } }), 400: errorResponse('No delivery partner assigned yet, or already picked up'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/picker/jobs/{id}/pickup/qr'] = {
  get: {
    tags: TAG,
    summary: 'Get the pickup QR token for MY store to render as a QR code for the delivery partner to scan (alternative to the OTP above)',
    ...bearer(), parameters: [idParam()],
    responses: { 200: envelope({ type: 'object', properties: { qrToken: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } } }), 400: errorResponse('No delivery partner assigned yet, or already picked up'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/picker/history'] = {
  get: { tags: TAG, summary: 'Completed/cancelled/failed jobs history', ...bearer(), parameters: PAGE_QS, responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
};
paths['/picker/performance'] = {
  get: { tags: TAG, summary: 'Productivity stats (total picked, substitutions made, avg pick time)', ...bearer(), responses: { 200: envelope({ type: 'object', properties: { totalPicked: { type: 'integer' }, substitutionsMade: { type: 'integer' }, avgPickTimeMinutes: { type: 'number', nullable: true } } }), 401: RESPONSES_401 } },
};

module.exports = paths;
