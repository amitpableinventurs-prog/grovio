const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_404, RESPONSES_422,
  jsonBody, formBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

const paths = {};
const TAG = ['Delivery'];

// ---------- Onboarding (after OTP signup; one endpoint per app screen) ----------
const Onboarding = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pending', 'approved', 'blocked'] },
    steps: { type: 'object', properties: { vehicle: { type: 'boolean' }, identity: { type: 'boolean' }, addressProof: { type: 'boolean' }, selfie: { type: 'boolean' }, bank: { type: 'boolean' } } },
    completedSteps: { type: 'integer', example: 2 },
    totalSteps: { type: 'integer', example: 5 },
    nextStep: { type: 'string', enum: ['vehicle', 'identity', 'addressProof', 'selfie', 'bank', 'pending_approval', 'home', 'blocked'] },
  },
};
const onboardingResult = (message) => envelope({ type: 'object', properties: { profile: ref('DeliveryProfile'), onboarding: Onboarding } }, message);
const RESPONSES_400_REVIEWED = errorResponse('Documents already reviewed (partner is approved or blocked)');
const image = { type: 'string', format: 'binary' };

paths['/delivery/onboarding'] = {
  get: {
    tags: TAG, summary: 'Onboarding progress + next screen, and the vehicle options', ...bearer(),
    responses: {
      200: envelope({ type: 'object', properties: {
        profile: ref('DeliveryProfile'),
        onboarding: Onboarding,
        vehicleTypes: { type: 'array', items: { type: 'object', properties: { value: { type: 'string', example: 'motorcycle' }, label: { type: 'string', example: 'Motorcycle' } } } },
      } }),
      401: RESPONSES_401, 404: RESPONSES_404,
    },
  },
};
paths['/delivery/onboarding/vehicle'] = {
  put: {
    tags: TAG, summary: 'Select vehicle screen', ...bearer(),
    requestBody: jsonBody({ vehicleType: { type: 'string', enum: ['motorcycle', 'bicycle', 'electric_scooter'] } }, ['vehicleType']),
    responses: { 200: onboardingResult('Vehicle saved'), 400: RESPONSES_400_REVIEWED, 401: RESPONSES_401, 422: RESPONSES_422 },
  },
};
paths['/delivery/onboarding/identity'] = {
  post: {
    tags: TAG, summary: 'Verify PAN / Aadhaar screen (details + card photo). An Aadhaar number / VID is returned masked.', ...bearer(),
    requestBody: formBody({
      idType: { type: 'string', enum: ['pan', 'aadhaar'] },
      idNumber: { type: 'string', example: 'ABCDE1234F', description: 'PAN (ABCDE1234F), 12-digit Aadhaar or 16-digit Aadhaar Virtual ID; spaces and dashes are ignored' },
      fullName: { type: 'string', example: 'Ravi Kumar' },
      gender: { type: 'string', enum: ['male', 'female', 'other'] },
      fatherName: { type: 'string', example: 'Suresh Kumar' },
      dateOfBirth: { type: 'string', example: '1998-04-21', description: 'YYYY-MM-DD, must be 18+' },
      document: { ...image, description: 'Photo of the card — required the first time' },
    }, ['idType', 'idNumber', 'fullName', 'gender', 'fatherName', 'dateOfBirth']),
    responses: { 200: onboardingResult('PAN details saved'), 400: RESPONSES_400_REVIEWED, 401: RESPONSES_401, 422: RESPONSES_422 },
  },
};
paths['/delivery/onboarding/address-proof'] = {
  post: {
    tags: TAG, summary: 'Submit address documents screen (voter ID / driving licence / ration card — not PAN). Send one or both sides.', ...bearer(),
    requestBody: formBody({ frontImage: image, backImage: image }),
    responses: { 200: onboardingResult('Address document saved'), 400: RESPONSES_400_REVIEWED, 401: RESPONSES_401, 422: RESPONSES_422 },
  },
};
paths['/delivery/onboarding/selfie'] = {
  post: {
    tags: TAG, summary: 'Take selfie screen', ...bearer(),
    requestBody: formBody({ selfie: image }, ['selfie']),
    responses: { 200: onboardingResult('Selfie saved'), 400: RESPONSES_400_REVIEWED, 401: RESPONSES_401, 422: RESPONSES_422 },
  },
};

paths['/delivery/onboarding/bank'] = {
  post: {
    tags: TAG, summary: 'Bank details screen — payout account (JSON, or multipart when sending the optional cheque/passbook photo)', ...bearer(),
    requestBody: formBody({
      accountHolderName: { type: 'string', example: 'Ravi Kumar' },
      accountNumber: { type: 'string', example: '123456789012', description: '9–18 digits' },
      ifsc: { type: 'string', example: 'SBIN0001234' },
      bankName: { type: 'string', example: 'State Bank of India' },
      confirmAccountNumber: { type: 'string', description: 'Optional; must match accountNumber when sent' },
      document: { ...image, description: 'Optional cancelled cheque / passbook photo' },
    }, ['accountHolderName', 'accountNumber', 'ifsc']),
    responses: { 200: onboardingResult('Bank details saved'), 400: RESPONSES_400_REVIEWED, 401: RESPONSES_401, 422: RESPONSES_422 },
  },
};

paths['/delivery/availability'] = {
  patch: { tags: TAG, summary: 'Toggle online/offline', ...bearer(), requestBody: jsonBody({ isAvailable: { type: 'boolean' } }, ['isAvailable']), responses: { 200: envelope(ref('DeliveryProfile'), 'Availability updated'), 401: RESPONSES_401 } },
};
paths['/delivery/location'] = {
  post: { tags: TAG, summary: 'Push current lat/lng', ...bearer(), requestBody: jsonBody({ lat: { type: 'number' }, lng: { type: 'number' } }, ['lat', 'lng']), responses: { 200: envelope(ref('DeliveryProfile'), 'Location updated'), 401: RESPONSES_401 } },
};
paths['/delivery/profile'] = {
  get: { tags: TAG, summary: 'Get my delivery profile', ...bearer(), responses: { 200: envelope(ref('DeliveryProfile')), 401: RESPONSES_401, 404: RESPONSES_404 } },
  patch: { tags: TAG, summary: 'Update vehicle/license details and the SOS emergency contact', ...bearer(), requestBody: jsonBody({ vehicleType: { type: 'string' }, vehicleNumber: { type: 'string' }, licenseNumber: { type: 'string' }, emergencyContactName: { type: 'string', example: 'Sunita (wife)' }, emergencyContactPhone: { type: 'string', example: '9876543210', description: 'Texted the live location when this partner raises an SOS' } }), responses: { 200: envelope(ref('DeliveryProfile'), 'Profile updated'), 401: RESPONSES_401 } },
};
const num = (example, description) => ({ type: 'number', nullable: true, example, ...(description ? { description } : {}) });
const RequestCard = {
  type: 'object',
  properties: {
    orderId: { type: 'string' },
    orderNumber: { type: 'string' },
    earning: num(42, 'What I will be paid (riderPayQuote.total)'),
    earningBreakup: { type: 'object', properties: { basePayout: num(30), peakBonus: num(12), rainBonus: num(0), heavyLoadBonus: num(0), kmSlab: { type: 'string', example: '1–2 km' } } },
    pickup: { type: 'object', properties: { name: { type: 'string', example: 'Bhawarkua dark store' }, address: { type: 'string' }, lat: num(22.69), lng: num(75.86), distanceKm: num(0.8, 'From my live location; null without a GPS fix from the last 10 min'), etaMinutes: num(3) } },
    drop: { type: 'object', properties: { title: { type: 'string', example: 'MG Road, near Regal Chowk' }, city: { type: 'string' }, lat: num(22.72), lng: num(75.87), distanceKm: num(1.8, 'Pickup -> drop') } },
    totalDistanceKm: num(2.6, 'Me -> pickup -> drop'),
    paymentMethod: { type: 'string', example: 'COD' },
    riderLocation: { type: 'object', nullable: true, properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
    respondBy: { type: 'string', format: 'date-time' },
    seconds: { type: 'integer', example: 30, description: 'Whole countdown (setting deliveryRequestSeconds, default 30)' },
    secondsLeft: { type: 'integer', example: 6 },
  },
};
paths['/delivery/requests'] = {
  get: {
    tags: TAG,
    summary: "\"New order request\" cards: orders assigned to me that I haven't accepted or rejected yet. Answer with POST /delivery/jobs/{id}/accept or /reject. The same card is pushed as the 'delivery:request' socket event the moment an order is assigned to me.",
    ...bearer(),
    parameters: [q('lat', 'Optional, overrides my last reported position'), q('lng', 'Optional, overrides my last reported position')],
    responses: { 200: envelope({ type: 'array', items: RequestCard }), 401: RESPONSES_401 },
  },
};
paths['/delivery/jobs'] = {
  get: { tags: TAG, summary: 'List my assigned/active jobs. Each order has riderPayQuote: mapped distance, KM pay, peak / rain / heavy-load bonus and estimated total — shown before accepting.', ...bearer(), parameters: [...PAGE_QS, q('status', "default: assigned,out_for_delivery")], responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
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
  post: { tags: TAG, summary: 'Verify the hub picker\'s handover OTP (order -> picked_up)', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ otp: { type: 'string', example: '4821' } }, ['otp']), responses: { 200: envelope(ref('Order'), 'Handover confirmed. Order picked up.'), 400: errorResponse('Incorrect or expired OTP'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/delivery/jobs/{id}/scan'] = {
  post: {
    tags: TAG, summary: 'Scan the hub picker\'s handover QR code (order -> picked_up) — alternative to otp/verify above; either one completes the handover', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({
      qrToken: { type: 'string', description: 'Decoded content of the scanned QR code' },
      deviceId: { type: 'string' },
      location: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
    }, ['qrToken']),
    responses: { 200: envelope(ref('Order'), 'Handover confirmed. Order picked up.'), 400: errorResponse('Invalid, expired, or unrelated QR code'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
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
paths['/delivery/jobs/{id}/return'] = {
  post: {
    tags: TAG, summary: 'Mark RTO complete — the never-delivered item has been brought back to the store (delivery_failed -> returned). Refunds the customer if already paid.', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ reason: { type: 'string' } }, ['reason']),
    responses: { 200: envelope(ref('Order'), 'Order marked as returned'), 400: errorResponse("Cannot move order from '<status>' to 'returned' — only allowed from delivery_failed"), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/delivery/history'] = {
  get: { tags: TAG, summary: 'Completed/failed/cancelled deliveries history', ...bearer(), parameters: PAGE_QS, responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
};
const HUB_ORDER = {
  type: 'object',
  properties: {
    _id: { type: 'string' }, orderNumber: { type: 'string' }, orderStatus: { type: 'string' }, itemCount: { type: 'integer' },
    paymentMethod: { type: 'string' }, paymentStatus: { type: 'string' }, grandTotal: { type: 'number' },
    readySince: { type: 'string', format: 'date-time', nullable: true }, deliveryAcceptedAt: { type: 'string', format: 'date-time', nullable: true },
    dropArea: { type: 'object', nullable: true, properties: { city: { type: 'string' }, pincode: { type: 'string' }, landmark: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } },
  },
};
const HUB_CHECKIN = {
  type: 'object',
  properties: {
    hub: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } },
    checkedInAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    mine: { type: 'array', items: HUB_ORDER, description: 'Assigned to me / picked up at this hub' },
    available: { type: 'array', items: HUB_ORDER, description: 'Packed, no delivery partner yet — claimable' },
  },
};
paths['/delivery/hub/scan'] = {
  post: {
    tags: TAG,
    summary: "The Delivery app's one scanner for hub screens. An order's QR (…/hub-checkin/?p=…) takes the order and picks it up in one step; the check-in QR (…/hub-checkin/?t=…) checks in, same as /delivery/hub/checkin",
    description: [
      'Send whatever the camera read as `code` (the full URL or just the token) and the phone\'s current `lat`/`lng`.',
      '',
      '**Order QR** (`type: "pickup"`):',
      '- The rider must be approved, online and within the pickup geofence of the hub (min 150 m). Otherwise 400.',
      "- A packed order with no rider becomes theirs (`packed -> assigned`, accepted). If another rider took it first: 409.",
      '- Then `assigned -> picked_up`. The QR leaves the screen and the screen flashes "#1234 → Ramesh" so the hub picker hands over the right bag.',
      '- Frozen items with no cold bag yet: `pickedUp: false`, `nextStep: "scan_cold_bag"`. The order stays theirs; scan a cold bag (`POST /delivery/jobs/{id}/cold-bag`), then this order QR again.',
      '- Next: `POST /delivery/jobs/{id}/out-for-delivery`, then open the map at `drop` (or `navigation.googleMapsUrl`) and keep sending `delivery:location` pings — the customer sees them live.',
      '',
      '**Check-in QR** (`type: "checkin"`): same response as `POST /delivery/hub/checkin`, plus `type`.',
    ].join('\n'),
    ...bearer(),
    requestBody: jsonBody({
      code: { type: 'string', description: 'The scanned QR content — the full URL or just the token' },
      lat: { type: 'number', example: 23.8343, description: 'Current position, for the at-the-hub check (falls back to the last GPS ping if recent)' },
      lng: { type: 'number', example: 80.3894 },
      deviceId: { type: 'string' },
    }, ['code']),
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['pickup', 'checkin'] },
          pickedUp: { type: 'boolean', description: 'pickup only' },
          nextStep: { type: 'string', enum: ['start_delivery', 'scan_cold_bag'], description: 'pickup only' },
          order: { ...ref('Order'), description: 'pickup only — with address, store and customer name populated' },
          drop: { type: 'object', nullable: true, properties: { lat: { type: 'number' }, lng: { type: 'number' } }, description: "pickup only — the customer's location" },
          navigation: { type: 'object', nullable: true, properties: { googleMapsUrl: { type: 'string' }, androidIntent: { type: 'string' } } },
        },
        description: 'For type "checkin" the fields of /delivery/hub/checkin (hub, checkedInAt, expiresAt, mine, available) come instead',
      }, 'Order GRV-…-4821 is yours. Take the bag and start the delivery.'),
      400: errorResponse('QR no longer valid, offline, not at the hub, no location, or order not ready'),
      401: RESPONSES_401,
      403: errorResponse('Account not approved'),
      409: errorResponse('Another delivery partner has already taken this order'),
    },
  },
};
paths['/delivery/hub/checkin'] = {
  post: {
    tags: TAG, summary: 'Check in at a Hub Center by scanning its screen\'s QR — single-use: the check-in replaces it with a new one', ...bearer(),
    requestBody: jsonBody({ code: { type: 'string', description: 'The scanned QR content — the full URL (…/hub-checkin/?t=…) or just the token' } }, ['code']),
    responses: { 200: envelope(HUB_CHECKIN, 'Checked in at <hub>'), 400: errorResponse('Hub QR already used or invalid, or inactive hub'), 401: RESPONSES_401, 403: errorResponse('Account not approved') },
  },
};
paths['/delivery/hub/orders'] = {
  get: { tags: TAG, summary: 'Orders at the hub I\'m checked in at (mine + available to claim)', ...bearer(), responses: { 200: envelope(HUB_CHECKIN), 401: RESPONSES_401, 403: errorResponse('Not checked in at a hub') } },
};
paths['/delivery/hub/orders/{id}/claim'] = {
  post: {
    tags: TAG, summary: 'Take a packed, unassigned order at my checked-in hub (assigns + accepts it: packed -> assigned)', ...bearer(), parameters: [idParam()],
    responses: { 200: envelope(ref('Order'), 'Order assigned to you'), 400: errorResponse('Not ready, or already yours'), 401: RESPONSES_401, 403: errorResponse('Not checked in at a hub'), 404: RESPONSES_404, 409: errorResponse('Another delivery partner already took it') },
  },
};
paths['/delivery/hub/checkout'] = {
  post: { tags: TAG, summary: 'End the hub check-in early', ...bearer(), responses: { 200: envelope({ type: 'object', nullable: true }, 'Checked out of the hub'), 401: RESPONSES_401 } },
};
paths['/delivery/earnings'] = {
  get: { tags: TAG, summary: 'Wallet balance + transaction history', ...bearer(), responses: { 200: envelope({ type: 'object', properties: { balance: { type: 'number' }, transactions: { type: 'array', items: ref('WalletTransaction') } } }), 401: RESPONSES_401 } },
};

module.exports = paths;
