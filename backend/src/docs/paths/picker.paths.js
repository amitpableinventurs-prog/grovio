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
  get: { tags: TAG, summary: 'List my assigned pick-lists (jobs)', ...bearer(), parameters: [...PAGE_QS, q('status', "default: accepted,picking,packed")], responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
};
paths['/picker/jobs/{id}'] = {
  get: { tags: TAG, summary: 'Get one job (pick-list) detail', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/jobs/{id}/start'] = {
  post: { tags: TAG, summary: 'Start picking (order -> picking)', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order'), 'Started picking'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/jobs/{id}/items/{itemId}'] = {
  patch: { tags: TAG, summary: 'Mark an item picked / out-of-stock / substituted', ...bearer(), parameters: [idParam(), idParam('itemId', 'Order item subdocument ID')], requestBody: jsonBody({ pickedQty: { type: 'integer' }, isAvailable: { type: 'boolean' }, substituteProductId: { type: 'string' }, substituteNote: { type: 'string' } }), responses: { 200: envelope(ref('OrderItem'), 'Item updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/jobs/{id}/substitutions'] = {
  post: { tags: TAG, summary: 'Record a substitution for an out-of-stock item (notifies the customer)', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ itemId: { type: 'string' }, substituteProductId: { type: 'string' }, substituteNote: { type: 'string' } }, ['itemId']), responses: { 200: envelope(ref('OrderItem'), 'Substitution recorded'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/jobs/{id}/complete'] = {
  post: { tags: TAG, summary: 'Complete packing (order -> packed, best-effort auto-assigns delivery)', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order'), 'Order packed'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/jobs/{id}/handover'] = {
  post: { tags: TAG, summary: 'Confirm physical hand-off to the assigned delivery partner', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order'), 'Handover confirmed'), 400: errorResponse('No delivery partner assigned yet'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/picker/history'] = {
  get: { tags: TAG, summary: 'Completed/cancelled/failed jobs history', ...bearer(), parameters: PAGE_QS, responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
};
paths['/picker/performance'] = {
  get: { tags: TAG, summary: 'Productivity stats (total picked, substitutions made, avg pick time)', ...bearer(), responses: { 200: envelope({ type: 'object', properties: { totalPicked: { type: 'integer' }, substitutionsMade: { type: 'integer' }, avgPickTimeMinutes: { type: 'number', nullable: true } } }), 401: RESPONSES_401 } },
};

module.exports = paths;
