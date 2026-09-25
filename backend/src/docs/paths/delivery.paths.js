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
    tags: TAG, summary: 'Verify PAN / Aadhaar screen (details + card photo). An Aadhaar number is returned masked.', ...bearer(),
    requestBody: formBody({
      idType: { type: 'string', enum: ['pan', 'aadhaar'] },
      idNumber: { type: 'string', example: 'ABCDE1234F', description: 'PAN (ABCDE1234F) or 12-digit Aadhaar; spaces are ignored' },
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
