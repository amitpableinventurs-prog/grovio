const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_403, RESPONSES_404,
  jsonBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

// Live tracking, IVR and the PayU / PhonePe gateways.
const paths = {};

const ETA = {
  type: 'object',
  nullable: true,
  properties: {
    etaMinutes: { type: 'integer', example: 12 },
    etaAt: { type: 'string', format: 'date-time' },
    remainingKm: { type: 'number', nullable: true, example: 2.4 },
    approximate: { type: 'boolean', description: 'A leg was guessed (missing coordinates or no rider GPS yet)' },
  },
};
const POINT = { type: 'object', nullable: true, properties: { lat: { type: 'number' }, lng: { type: 'number' } } };
const TRACKING = {
  type: 'object',
  properties: {
    orderNumber: { type: 'string' },
    orderStatus: { type: 'string' },
    deliveryPartner: { type: 'object', nullable: true, properties: { name: { type: 'string' }, phone: { type: 'string' } } },
    hub: { ...POINT, properties: { ...POINT.properties, name: { type: 'string' } } },
    drop: POINT,
    rider: { ...POINT, properties: { ...POINT.properties, updatedAt: { type: 'string', format: 'date-time' } } },
    eta: ETA,
    arrivedAtDropAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

// ---- Tracking -------------------------------------------------------------------------------
paths['/customer/orders/{id}/tracking'] = {
  get: {
    tags: ['Customer - Checkout & Orders'],
    summary: 'Status timeline + live tracking (hub, drop, rider GPS, ETA). Live updates: socket event delivery:location { orderId, lat, lng, eta }',
    ...bearer(), parameters: [idParam()],
    responses: { 200: envelope({ ...TRACKING, properties: { ...TRACKING.properties, statusLogs: { type: 'array', items: { type: 'object' } } } }), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/delivery/route'] = {
  get: {
    tags: ['Delivery'],
    summary: 'My active orders as an optimised list of stops (hub pickups before their drops) with leg distances, arrival estimates and a Google Maps link',
    ...bearer(), parameters: [q('lat', 'Override my last reported latitude', { type: 'number' }), q('lng', 'Override my last reported longitude', { type: 'number' })],
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          start: POINT,
          stops: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sequence: { type: 'integer' }, type: { type: 'string', enum: ['pickup', 'drop'] }, label: { type: 'string' }, address: { type: 'string' },
                lat: { type: 'number' }, lng: { type: 'number' }, orderIds: { type: 'array', items: { type: 'string' } }, orderNumbers: { type: 'array', items: { type: 'string' } },
                legKm: { type: 'number', nullable: true }, arriveBy: { type: 'string', format: 'date-time' },
              },
            },
          },
          unplanned: { type: 'array', items: { type: 'object' }, description: 'Orders that could not be placed on the route (no coordinates)' },
          totalKm: { type: 'number' },
          totalMinutes: { type: 'integer' },
          googleMapsUrl: { type: 'string', nullable: true },
        },
      }),
      401: RESPONSES_401,
    },
  },
};
paths['/admin/tracking/riders'] = {
  get: {
    tags: ['Admin - Orders'], summary: 'Live map: online / on-the-job delivery partners with last GPS fix and active orders, plus store locations. Live: socket event rider:location', ...bearer(),
    responses: { 200: envelope({ type: 'object', properties: { riders: { type: 'array', items: { type: 'object' } }, stores: { type: 'array', items: { type: 'object' } }, staleAfterMinutes: { type: 'integer' } } }), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
};
paths['/admin/orders/{id}/tracking'] = {
  get: { tags: ['Admin - Orders'], summary: 'Live tracking snapshot for one order (same as the customer view, plus geofence timestamps)', ...bearer(), parameters: [idParam()], responses: { 200: envelope(TRACKING), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 } },
};

// ---- IVR --------------------------------------------------------------------------------------
const IVR_CALL = {
  type: 'object',
  properties: {
    _id: { type: 'string' },
    type: { type: 'string', enum: ['order_confirmation', 'status_update', 'delivery_alert', 'missed_call', 'missed_call_callback', 'customer_care'] },
    direction: { type: 'string', enum: ['outbound', 'inbound'] },
    phone: { type: 'string' }, event: { type: 'string', nullable: true }, message: { type: 'string', nullable: true },
    provider: { type: 'string', enum: ['exotel', 'simulated'] },
    status: { type: 'string', enum: ['queued', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'simulated'] },
    dtmf: { type: 'string', nullable: true }, outcome: { type: 'string', nullable: true }, durationSec: { type: 'number', nullable: true }, error: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};
paths['/admin/ivr/calls'] = {
  get: { tags: ['Admin - Support'], summary: 'IVR call log (in and out)', ...bearer(), parameters: [...PAGE_QS, q('type', 'Call type'), q('status', 'Call status'), q('orderId', 'Order')], responses: { 200: envelope(paginated(IVR_CALL)), 401: RESPONSES_401, 403: RESPONSES_403 } },
};
paths['/admin/ivr/config'] = {
  get: { tags: ['Admin - Settings'], summary: 'IVR provider state and the webhook URLs to paste into the Exotel call flows', ...bearer(), responses: { 200: envelope({ type: 'object' }), 401: RESPONSES_401, 403: RESPONSES_403 } },
};
paths['/admin/orders/{id}/ivr-call'] = {
  post: {
    tags: ['Admin - Orders'], summary: 'Call the customer now: kind=status reads out the order status; kind=confirmation asks a COD customer to press 1 (confirm) / 2 (cancel)', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ kind: { type: 'string', enum: ['status', 'confirmation'] } }),
    responses: { 200: envelope(IVR_CALL, 'Call placed'), 400: errorResponse('Not a COD order / no phone'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};
const exotelHook = (summary, textResponse = false) => ({
  tags: ['IVR (Exotel webhooks)'], summary,
  parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' }, description: 'Secret webhook token (Admin > Settings > IVR shows the full URLs)' },
    q('CallSid', 'Exotel call id'), q('From', 'Caller number'), q('digits', 'Key pressed (Gather)'), q('CustomField', 'Our IvrCall id (outbound calls)')],
  responses: { 200: { description: textResponse ? 'Plain text read out by Exotel TTS' : 'OK', content: { 'text/plain': { schema: { type: 'string' } } } }, 404: errorResponse('Wrong token') },
});
paths['/ivr/exotel/{token}/prompt'] = { get: exotelHook('Greeting text for an outbound call (?stage=result after a key press)', true) };
paths['/ivr/exotel/{token}/input'] = { get: exotelHook('Passthru after Gather on the COD confirmation flow: 1 = confirm, 2 = cancel') };
paths['/ivr/exotel/{token}/status'] = { post: exotelHook('StatusCallback when a call ends (JSON or form)') };
paths['/ivr/exotel/{token}/missed-call'] = { get: exotelHook('Passthru on the missed-call number: SMS + call back with the latest order status') };
paths['/ivr/exotel/{token}/care/prompt'] = { get: exotelHook('Customer care menu greeting', true) };
paths['/ivr/exotel/{token}/care/input'] = { get: { ...exotelHook('Care menu key press: 1 status, 2 agent (responds 302 → Connect), 3 call back'), responses: { 200: { description: 'Success branch' }, 302: { description: 'Connect to support agent' } } } };
paths['/ivr/exotel/{token}/care/result'] = { get: exotelHook('Care menu result text', true) };

// ---- PayU / PhonePe ---------------------------------------------------------------------------
const PAY_TAG = ['Payments'];
paths['/payments/payu/create'] = {
  post: {
    tags: PAY_TAG, summary: 'Start a PayU payment for an order placed with paymentMethod PAYU — submit `fields` as a form POST to `action`', ...bearer(),
    requestBody: jsonBody({ orderId: { type: 'string' } }, ['orderId']),
    responses: { 200: envelope({ type: 'object', properties: { action: { type: 'string', example: 'https://test.payu.in/_payment' }, fields: { type: 'object', additionalProperties: { type: 'string' } } } }), 400: errorResponse('Wrong method / already paid'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/payments/payu/callback'] = {
  post: { tags: PAY_TAG, summary: 'PayU surl/furl (form POST from the browser). Verifies the reverse hash and redirects to <customerWebUrl>/payment/return', responses: { 303: { description: 'Redirect to the customer web app' } } },
};
paths['/payments/payu/webhook'] = {
  post: { tags: PAY_TAG, summary: 'PayU server-to-server notification (same fields as the callback)', responses: { 200: { description: 'Received' }, 400: errorResponse('Invalid hash') } },
};
paths['/payments/phonepe/create'] = {
  post: {
    tags: PAY_TAG, summary: 'Start a PhonePe Standard Checkout payment for an order placed with paymentMethod PHONEPE — send the customer to redirectUrl', ...bearer(),
    requestBody: jsonBody({ orderId: { type: 'string' } }, ['orderId']),
    responses: { 200: envelope({ type: 'object', properties: { redirectUrl: { type: 'string' }, merchantOrderId: { type: 'string' } } }), 400: errorResponse('Wrong method / already paid'), 401: RESPONSES_401, 404: RESPONSES_404, 502: errorResponse('PhonePe error') },
  },
};
paths['/payments/phonepe/verify'] = {
  post: {
    tags: PAY_TAG, summary: 'Check the order\'s PhonePe payment with PhonePe (call from the return page)', ...bearer(),
    requestBody: jsonBody({ orderId: { type: 'string' } }, ['orderId']),
    responses: { 200: envelope({ type: 'object', properties: { order: ref('Order'), paymentStatus: { type: 'string' } } }), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/payments/phonepe/webhook'] = {
  post: { tags: PAY_TAG, summary: 'PhonePe webhook. Authorization header = SHA256("<username>:<password>")', responses: { 200: { description: 'Received' }, 401: errorResponse('Bad authorization') } },
};

module.exports = paths;
