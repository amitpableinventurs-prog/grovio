const {
  envelope, paginated,
  RESPONSES_401, RESPONSES_403, RESPONSES_404, RESPONSES_422,
  jsonBody, idParam, q, PAGE_QS, bearer, errorResponse,
} = require('../helpers');

// Alert messages: set in Admin > Alert Messages, shown by the Customer / Picker / Delivery apps as a
// banner across the top or a popup when opened (services/appAlert.service.js).
const paths = {};
const TAG = ['Alert Messages'];
const ADMIN_TAG = ['Admin - Alert Messages'];

const APP = { type: 'string', enum: ['customer', 'picker', 'delivery'] };
const SEVERITY = { type: 'string', enum: ['info', 'success', 'warning', 'critical'], description: 'Colour: info blue, success green, warning amber, critical red' };
const DISPLAY = { type: 'string', enum: ['banner', 'popup'], description: 'banner: a strip across the top of the screens; popup: a dialog when the app opens' };
const CTA = { type: 'object', nullable: true, properties: { label: { type: 'string', example: 'Track order' }, url: { type: 'string', example: 'https://grovio.in/help/rain' } } };
const APP_ALERT = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string', nullable: true, example: 'Heavy rain' },
    message: { type: 'string', example: 'Deliveries may take a little longer today. Thanks for your patience!' },
    severity: SEVERITY,
    display: DISPLAY,
    dismissible: { type: 'boolean', example: true, description: 'Show a close (X) button' },
    cta: CTA,
    startsAt: { type: 'string', format: 'date-time', nullable: true },
    endsAt: { type: 'string', format: 'date-time', nullable: true },
    dismissKey: { type: 'string', example: '6ae1…:3f9a1c0b2d', description: 'Store this when the user closes the alert and skip alerts whose key is stored. It changes when the admin edits the text, colour, style or button (so the edited alert shows again), not when the alert is switched off and on.' },
  },
};
const ALERT_INPUT = {
  title: { type: 'string', nullable: true, maxLength: 80, example: 'Heavy rain' },
  message: { type: 'string', minLength: 2, maxLength: 500, example: 'Deliveries may take a little longer today. Thanks for your patience!' },
  severity: { ...SEVERITY, default: 'info' },
  display: { ...DISPLAY, default: 'banner' },
  apps: { type: 'array', items: APP, minItems: 1, example: ['customer'] },
  dismissible: { type: 'boolean', default: true },
  cta: { ...CTA, description: 'Optional button; needs both label and url (http/https). null removes it.' },
  startsAt: { type: 'string', format: 'date-time', nullable: true, description: 'null = right away' },
  endsAt: { type: 'string', format: 'date-time', nullable: true, description: 'null = until switched off' },
  isActive: { type: 'boolean', default: true, description: 'On/off switch' },
};
const ADMIN_ALERT = {
  type: 'object',
  properties: {
    _id: { type: 'string' },
    ...ALERT_INPUT,
    status: { type: 'string', enum: ['live', 'scheduled', 'ended', 'off'] },
    updatedBy: { type: 'object', nullable: true, properties: { name: { type: 'string' } } },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

paths['/common/alerts'] = {
  get: {
    tags: TAG,
    summary: 'Alerts this app should show now (critical first)',
    description: 'Call on app open / resume, and again when the socket event `alerts:changed` arrives (sent to the app\'s role room whenever an admin adds, edits, switches or deletes an alert). Signed in, the token\'s role picks the app; signed out, pass ?app=.',
    ...bearer(),
    parameters: [q('app', 'Only when signed out: customer | picker | delivery')],
    responses: { 200: envelope({ type: 'array', items: APP_ALERT }), 400: errorResponse('Signed out and no ?app='), 422: RESPONSES_422 },
  },
};

paths['/admin/alerts'] = {
  get: {
    tags: ADMIN_TAG, summary: 'Alert messages, newest first', ...bearer(),
    parameters: [...PAGE_QS, q('status', 'live | scheduled | ended | off'), q('app', 'customer | picker | delivery')],
    responses: { 200: envelope(paginated(ADMIN_ALERT)), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
  post: {
    tags: ADMIN_TAG, summary: 'Create an alert (live right away unless startsAt is later or isActive is false)', ...bearer(),
    requestBody: jsonBody(ALERT_INPUT, ['message', 'apps']),
    responses: { 201: envelope(ADMIN_ALERT), 401: RESPONSES_401, 403: RESPONSES_403, 422: RESPONSES_422 },
  },
};
paths['/admin/alerts/{id}'] = {
  get: { tags: ADMIN_TAG, summary: 'One alert', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ADMIN_ALERT), 401: RESPONSES_401, 404: RESPONSES_404 } },
  put: {
    tags: ADMIN_TAG, summary: 'Edit an alert (a changed text, colour, style or button shows it again to users who closed it)', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody(ALERT_INPUT, ['message', 'apps']),
    responses: { 200: envelope(ADMIN_ALERT), 401: RESPONSES_401, 404: RESPONSES_404, 422: RESPONSES_422 },
  },
  delete: { tags: ADMIN_TAG, summary: 'Delete an alert', ...bearer(), parameters: [idParam()], responses: { 200: envelope({ type: 'object', nullable: true }), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/admin/alerts/{id}/active'] = {
  patch: {
    tags: ADMIN_TAG, summary: 'Switch an alert on or off', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ isActive: { type: 'boolean', example: false } }, ['isActive']),
    responses: { 200: envelope(ADMIN_ALERT), 401: RESPONSES_401, 404: RESPONSES_404, 422: RESPONSES_422 },
  },
};

module.exports = paths;
