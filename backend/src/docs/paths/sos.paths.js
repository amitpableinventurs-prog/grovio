const {
  envelope, errorResponse,
  RESPONSES_401, RESPONSES_403, RESPONSES_404, RESPONSES_422,
  jsonBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

// SOS: Customer / Picker / Delivery apps raise it, the ops team handles it — services/sos.service.js.
const paths = {};
const TAG = ['SOS'];
const ADMIN_TAG = ['Admin - SOS'];

const POINT = { type: 'object', nullable: true, properties: { lat: { type: 'number' }, lng: { type: 'number' }, accuracyM: { type: 'number', nullable: true }, at: { type: 'string', format: 'date-time' } } };
const HELPLINE = { type: 'object', properties: { key: { type: 'string', example: 'ambulance' }, label: { type: 'string', example: 'Ambulance' }, number: { type: 'string', example: '108' } } };
const STATUS = { type: 'string', enum: ['open', 'acknowledged', 'resolved', 'cancelled'] };
const CALL = { type: 'object', properties: { key: { type: 'string' }, number: { type: 'string' }, at: { type: 'string', format: 'date-time' } } };
const MY_ALERT = {
  type: 'object',
  properties: {
    _id: { type: 'string' }, kind: { type: 'string', example: 'police' }, status: STATUS, note: { type: 'string', nullable: true },
    location: POINT, calls: { type: 'array', items: CALL },
    acknowledgedAt: { type: 'string', format: 'date-time', nullable: true, description: 'Set when the ops team has seen it — show "Help is on the way"' },
    resolvedAt: { type: 'string', format: 'date-time', nullable: true }, resolutionNote: { type: 'string', nullable: true },
    cancelledAt: { type: 'string', format: 'date-time', nullable: true }, createdAt: { type: 'string', format: 'date-time' },
  },
};
const ADMIN_ALERT = {
  type: 'object',
  properties: {
    ...MY_ALERT.properties,
    user: { type: 'object', properties: { _id: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' }, role: { type: 'string' } } },
    role: { type: 'string', enum: ['customer', 'picker', 'delivery'] },
    trail: { type: 'array', items: POINT, description: 'Every location update while open (detail only)' },
    order: { type: 'object', nullable: true, properties: { _id: { type: 'string' }, orderNumber: { type: 'string' }, orderStatus: { type: 'string' } } },
    store: { type: 'object', nullable: true, properties: { _id: { type: 'string' }, name: { type: 'string' } } },
    contactsNotified: {
      type: 'array',
      items: { type: 'object', properties: { kind: { type: 'string', enum: ['emergency_contact', 'ops'] }, name: { type: 'string', nullable: true }, phone: { type: 'string' }, sent: { type: 'boolean' }, reason: { type: 'string', nullable: true } } },
    },
    acknowledgedBy: { type: 'object', nullable: true, properties: { name: { type: 'string' } } },
    resolvedBy: { type: 'object', nullable: true, properties: { name: { type: 'string' } } },
  },
};
const NOT_ALLOWED = errorResponse('Only the Customer, Picker and Delivery apps can use SOS');

paths['/common/sos/config'] = {
  get: {
    tags: TAG, summary: 'SOS screen data: helpline numbers to show, my emergency contact, and my open SOS (if any)', ...bearer(),
    description: 'Helplines are admin-editable (India defaults: 112, 100, 108, 101, 1091, 1033; plus "Grovio safety team" when an ops phone is set). Cache them on the phone so the SOS screen works offline.',
    responses: {
      200: envelope({ type: 'object', properties: { helplines: { type: 'array', items: HELPLINE }, emergencyContact: { type: 'object', nullable: true, properties: { name: { type: 'string', nullable: true }, phone: { type: 'string' } } }, activeAlert: { ...MY_ALERT, nullable: true } } }),
      401: RESPONSES_401, 403: NOT_ALLOWED,
    },
  },
};
paths['/common/sos'] = {
  post: {
    tags: TAG,
    summary: 'Raise an SOS, or log a helpline call on my open SOS',
    description: [
      'The **app dials the helpline itself** (`tel:` + number) — emergency numbers can\'t be called through any API. Start the call first and send this in parallel, never wait for it.',
      '',
      '- `kind`: `sos` (the big SOS button) or a helpline `key` from `/common/sos/config`.',
      '- One active SOS per person: calling again (e.g. police, then ambulance) adds to the same alert (200 instead of 201).',
      '- New SOS: the ops team gets a siren in the admin panel (`sos:alert`), and the emergency contact + ops phone get an SMS with a map link.',
      '- Then send `POST /common/sos/{id}/location` every ~10 s until it\'s resolved or cancelled. Listen for `sos:updated` on the socket (acknowledged → "Help is on the way").',
    ].join('\n'),
    ...bearer(),
    requestBody: jsonBody({
      kind: { type: 'string', example: 'ambulance' },
      lat: { type: 'number', example: 23.8343 }, lng: { type: 'number', example: 80.3894 }, accuracy: { type: 'number', example: 12, description: 'GPS accuracy in metres' },
      note: { type: 'string', example: 'Bike accident near the hub' },
      orderId: { type: 'string', description: 'Customer app: the order this is about (pickers/riders: found automatically)' },
    }, ['kind']),
    responses: {
      201: envelope({ type: 'object', properties: { alert: MY_ALERT, created: { type: 'boolean' }, dial: { type: 'string', nullable: true, example: '108' }, helplines: { type: 'array', items: HELPLINE } } }, 'SOS sent. Our team has been alerted.'),
      200: envelope({ type: 'object' }, 'SOS updated'),
      401: RESPONSES_401, 403: NOT_ALLOWED, 422: errorResponse("kind must be 'sos' or a helpline key"),
    },
  },
  get: { tags: TAG, summary: 'My past SOS alerts', ...bearer(), parameters: PAGE_QS, responses: { 200: envelope({ type: 'object', properties: { items: { type: 'array', items: MY_ALERT } } }), 401: RESPONSES_401, 403: NOT_ALLOWED } },
};
paths['/common/sos/{id}/location'] = {
  post: {
    tags: TAG, summary: 'Live location while my SOS is open (every ~10 s)', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ lat: { type: 'number' }, lng: { type: 'number' }, accuracy: { type: 'number' } }, ['lat', 'lng']),
    responses: { 200: envelope(MY_ALERT, 'Location updated'), 400: errorResponse('This SOS is already resolved/cancelled — stop sending'), 401: RESPONSES_401, 404: RESPONSES_404, 422: RESPONSES_422 },
  },
};
paths['/common/sos/{id}/cancel'] = {
  post: {
    tags: TAG, summary: '"I\'m safe" — cancel my open SOS', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ reason: { type: 'string', example: 'Pressed by mistake' } }),
    responses: { 200: envelope(MY_ALERT, 'SOS cancelled'), 400: errorResponse('Already resolved/cancelled'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};

paths['/admin/sos'] = {
  get: {
    tags: ADMIN_TAG, summary: 'SOS alerts, newest first (store managers: their store only). Live: socket sos:alert / sos:updated / sos:location', ...bearer(),
    parameters: [
      q('status', 'active (open + acknowledged) | open | acknowledged | resolved | cancelled'),
      q('role', 'delivery | picker | customer'),
      ...PAGE_QS,
    ],
    responses: { 200: envelope({ type: 'object', properties: { items: { type: 'array', items: ADMIN_ALERT }, activeCount: { type: 'integer' } } }), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
};
paths['/admin/sos/{id}'] = {
  get: { tags: ADMIN_TAG, summary: 'One SOS with its location trail', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ADMIN_ALERT), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 } },
};
paths['/admin/sos/{id}/acknowledge'] = {
  post: { tags: ADMIN_TAG, summary: '"We\'re on it" — the person\'s app is told (sos:updated)', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ADMIN_ALERT, 'SOS acknowledged'), 400: errorResponse('Not open'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 } },
};
paths['/admin/sos/{id}/resolve'] = {
  post: {
    tags: ADMIN_TAG, summary: 'Close the SOS with what was done', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ note: { type: 'string', example: 'Called the rider; minor fall, ambulance not needed' } }),
    responses: { 200: envelope(ADMIN_ALERT, 'SOS resolved'), 400: errorResponse('Already resolved/cancelled'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};

module.exports = paths;
