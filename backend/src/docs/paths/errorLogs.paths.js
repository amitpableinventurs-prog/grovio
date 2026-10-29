const {
  envelope, paginated, errorResponse,
  RESPONSES_401, RESPONSES_403, RESPONSES_404, RESPONSES_422,
  jsonBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

// Error logs: the backend logs its own errors; the Customer / Picker / Delivery apps (and web
// panels) report theirs here. Admin > Error Logs shows them by date and time.
const paths = {};
const TAG = ['Error Logs'];
const ADMIN_TAG = ['Admin - Error Logs'];

const APP = { type: 'string', enum: ['customer', 'picker', 'delivery', 'vendor', 'admin'] };
const LEVEL = { type: 'string', enum: ['fatal', 'error', 'warning'], default: 'error' };
const CLIENT_ERROR = {
  type: 'object',
  required: ['message', 'app'],
  properties: {
    message: { type: 'string', example: "type 'Null' is not a subtype of type 'String'" },
    app: APP,
    source: { type: 'string', enum: ['mobile', 'web'], default: 'mobile' },
    level: LEVEL,
    stack: { type: 'string', nullable: true, example: '#0 OrderCard.build (package:grovio/order_card.dart:42:18)' },
    occurredAt: { type: 'string', format: 'date-time', description: 'When it happened on the device (send it — errors queued offline arrive later). Defaults to now.' },
    screen: { type: 'string', nullable: true, example: 'OrderDetailScreen' },
    method: { type: 'string', nullable: true, example: 'GET', description: 'For a failed API call' },
    url: { type: 'string', nullable: true, example: '/api/v1/delivery/jobs/66f1…' },
    statusCode: { type: 'integer', nullable: true, example: 500 },
    platform: { type: 'string', enum: ['android', 'ios', 'web'] },
    appVersion: { type: 'string', example: '1.4.2+18' },
    deviceModel: { type: 'string', example: 'Redmi Note 12' },
    osVersion: { type: 'string', example: 'Android 13' },
    context: { type: 'object', nullable: true, description: 'Anything else useful (max ~8 KB). Keys like password / otp / token / pin are masked.' },
  },
};
const LOG = {
  type: 'object',
  properties: {
    _id: { type: 'string' },
    source: { type: 'string', enum: ['backend', 'mobile', 'web'] },
    app: { type: 'string', enum: ['backend', 'customer', 'picker', 'delivery', 'vendor', 'admin'] },
    level: LEVEL,
    message: { type: 'string' },
    occurredAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time', description: 'When the server received it' },
    method: { type: 'string', nullable: true },
    url: { type: 'string', nullable: true },
    statusCode: { type: 'integer', nullable: true },
    screen: { type: 'string', nullable: true },
    platform: { type: 'string', nullable: true },
    appVersion: { type: 'string', nullable: true },
    deviceModel: { type: 'string', nullable: true },
    osVersion: { type: 'string', nullable: true },
    user: { type: 'object', nullable: true, properties: { _id: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' } } },
    role: { type: 'string', nullable: true },
    ip: { type: 'string', nullable: true },
    userAgent: { type: 'string', nullable: true },
    stack: { type: 'string', nullable: true, description: 'Detail only' },
    context: { type: 'object', nullable: true, description: 'Detail only. Backend: the request query / params / body (secrets masked)' },
  },
};
const FILTER_QS = [
  q('from', 'From date-time (ISO), on when it happened', { type: 'string', format: 'date-time' }),
  q('to', 'To date-time (ISO)', { type: 'string', format: 'date-time' }),
  q('source', 'backend | mobile | web'),
  q('app', 'backend | customer | picker | delivery | vendor | admin'),
  q('level', 'fatal | error | warning'),
  q('search', 'Text in the message, URL or screen'),
];

paths['/common/error-logs'] = {
  post: {
    tags: TAG,
    summary: 'Report an app error (login optional)',
    description: 'Send one error, or `{ "errors": [ … ] }` with up to 20 (e.g. a queue saved while offline). With a valid Bearer token the error is tied to that user; without one (or with an expired token) it is still saved. At most 100 errors per IP per 10 minutes.',
    ...bearer(),
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { oneOf: [CLIENT_ERROR, { type: 'object', properties: { errors: { type: 'array', minItems: 1, maxItems: 20, items: CLIENT_ERROR } } }] } } },
    },
    responses: { 201: envelope({ type: 'object', properties: { saved: { type: 'integer', example: 1 } } }, 'Error logged'), 422: RESPONSES_422, 429: errorResponse('Too many error reports from this IP') },
  },
};

paths['/admin/error-logs'] = {
  get: {
    tags: ADMIN_TAG,
    summary: 'Error logs by date and time (newest first), with a count per source',
    ...bearer(),
    parameters: [...PAGE_QS, ...FILTER_QS, q('sort', 'newest (default) | oldest')],
    responses: {
      200: envelope({ type: 'object', properties: { ...paginated(LOG).properties, summary: { type: 'object', properties: { backend: { type: 'integer' }, mobile: { type: 'integer' }, web: { type: 'integer' } } } } }),
      401: RESPONSES_401, 403: RESPONSES_403, 422: RESPONSES_422,
    },
  },
  delete: {
    tags: ADMIN_TAG,
    summary: 'Delete every log matching the filters (no filters = all)',
    ...bearer(),
    parameters: FILTER_QS,
    responses: { 200: envelope({ type: 'object', properties: { deleted: { type: 'integer', example: 42 } } }), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
};

paths['/admin/error-logs/{id}'] = {
  get: { tags: ADMIN_TAG, summary: 'One error with its stack trace and context', ...bearer(), parameters: [idParam()], responses: { 200: envelope(LOG), 401: RESPONSES_401, 404: RESPONSES_404 } },
  delete: { tags: ADMIN_TAG, summary: 'Delete one error log', ...bearer(), parameters: [idParam()], responses: { 200: envelope({ type: 'object', nullable: true }), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

module.exports = paths;
