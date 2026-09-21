const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_404,
  jsonBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

const paths = {};
const TAG = ['Delivery'];

paths['/delivery/availability'] = {
  patch: { tags: TAG, summary: 'Toggle online/offline', ...bearer(), requestBody: jsonBody({ isAvailable: { type: 'boolean' } }, ['isAvailable']), responses: { 200: envelope(ref('DeliveryProfile'), 'Availability updated'), 401: RESPONSES_401 } },
};
paths['/delivery/location'] = {
  post: { tags: TAG, summary: 'Push current lat/lng', ...bearer(), requestBody: jsonBody({ lat: { type: 'number' }, lng: { type: 'number' } }, ['lat', 'lng']), responses: { 200: envelope(ref('DeliveryProfile'), 'Location updated'), 401: RESPONSES_401 } },
};
paths['/delivery/profile'] = {
  get: { tags: TAG, summary: 'Get my delivery profile', ...bearer(), responses: { 200: envelope(ref('DeliveryProfile')), 401: RESPONSES_401, 404: RESPONSES_404 } },
  patch: { tags: TAG, summary: 'Update vehicle/license details', ...bearer(), requestBody: jsonBody({ vehicleType: { type: 'string' }, vehicleNumber: { type: 'string' }, licenseNumber: { type: 'string' } }), responses: { 200: envelope(ref('DeliveryProfile'), 'Profile updated'), 401: RESPONSES_401 } },
};
paths['/delivery/jobs'] = {
  get: { tags: TAG, summary: 'List my assigned/active jobs', ...bearer(), parameters: [...PAGE_QS, q('status', "default: assigned,out_for_delivery")], responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
};
paths['/delivery/jobs/{id}'] = {
  get: { tags: TAG, summary: 'Get one job detail', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/accept'] = {
  post: { tags: TAG, summary: 'Accept this delivery assignment', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order'), 'Job accepted'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/reject'] = {
  post: { tags: TAG, summary: 'Reject this assignment (order returns to packed, awaiting reassignment)', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ reason: { type: 'string' } }), responses: { 200: envelope(ref('Order'), 'Assignment rejected'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/arrived-pickup'] = {
  post: { tags: TAG, summary: 'Mark arrival at the store', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order'), 'Arrival at store recorded'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/pickers'] = {
  get: { tags: TAG, summary: 'Get the picker(s) assigned to this order (for handover identification)', ...bearer(), parameters: [idParam()], responses: { 200: envelope({ type: 'array', items: ref('PickerProfile') }), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/otp/verify'] = {
  post: { tags: TAG, summary: 'Verify the picker\'s handover OTP (order -> picked_up). The only path to this status.', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ otp: { type: 'string', example: '4821' } }, ['otp']), responses: { 200: envelope(ref('Order'), 'Handover confirmed. Order picked up.'), 400: errorResponse('Incorrect or expired OTP'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/out-for-delivery'] = {
  post: { tags: TAG, summary: 'Depart with the package after a verified handover (order -> out_for_delivery)', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order'), 'Marked as out for delivery'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/arrived-drop'] = {
  post: { tags: TAG, summary: 'Mark arrival at the customer\'s address', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order'), 'Arrival at customer recorded'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/complete'] = {
  post: { tags: TAG, summary: 'Complete delivery — requires the customer\'s PIN', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ pin: { type: 'string', example: '4552' } }, ['pin']), responses: { 200: envelope(ref('Order'), 'Order delivered'), 400: errorResponse('Incorrect delivery PIN'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/failed'] = {
  post: { tags: TAG, summary: 'Mark delivery attempt as failed, with a reason', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ reason: { type: 'string' } }, ['reason']), responses: { 200: envelope(ref('Order'), 'Delivery marked as failed'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/history'] = {
  get: { tags: TAG, summary: 'Completed/failed/cancelled deliveries history', ...bearer(), parameters: PAGE_QS, responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
};
paths['/delivery/earnings'] = {
  get: { tags: TAG, summary: 'Wallet balance + transaction history', ...bearer(), responses: { 200: envelope({ type: 'object', properties: { balance: { type: 'number' }, transactions: { type: 'array', items: ref('WalletTransaction') } } }), 401: RESPONSES_401 } },
};

module.exports = paths;
