const S = require('../schemas');
const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_403, RESPONSES_404,
  jsonBody, formBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

const paths = {};

// ============================== AUTH ==============================

paths['/auth/login'] = {
  post: {
    tags: ['Auth'],
    summary: 'Admin login (email + password) — also used by store-manager sub-admin accounts',
    requestBody: jsonBody({
      email: { type: 'string', example: 'admin@grovio.com' },
      password: { type: 'string', example: 'Admin@12345' },
      deviceId: { type: 'string' },
      platform: { type: 'string', enum: ['android', 'ios', 'web'] },
    }, ['email', 'password']),
    responses: {
      200: envelope(ref('AuthTokens'), 'Login successful'),
      401: errorResponse('Invalid email or password'),
      403: errorResponse('Account has been disabled'),
    },
  },
};

const otpPhoneFields = {
  countryCode: { type: 'string', example: '+91', description: 'Alternative to `phone` — send this + mobile' },
  mobile: { type: 'string', example: '9876543210', description: 'Alternative to `phone` — send this + countryCode' },
  phone: { type: 'string', example: '+919876543210', description: 'Alternative to countryCode+mobile — already-combined number' },
};

paths['/auth/send-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Send OTP to a phone number (Customer/Picker/Delivery login)',
    description: 'Send either `{ countryCode, mobile }` (what the Flutter apps use) or a combined `{ phone }`. Rate-limited server-side: repeat calls within the cooldown window return 429.',
    requestBody: jsonBody(otpPhoneFields),
    responses: {
      200: envelope({ type: 'object', properties: { sent: { type: 'boolean' }, resendCooldownSeconds: { type: 'integer', example: 30 }, debugOtp: { type: 'string', example: '1234', description: 'Only present when OTP_DEBUG_MODE=true' } } }, 'OTP sent successfully'),
      429: errorResponse('Please wait Ns before requesting another OTP'),
    },
  },
};

paths['/auth/resend-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Resend OTP (identical behavior/body to send-otp, same cooldown applies)',
    requestBody: jsonBody(otpPhoneFields),
    responses: {
      200: envelope({ type: 'object', properties: { sent: { type: 'boolean' }, resendCooldownSeconds: { type: 'integer', example: 30 }, debugOtp: { type: 'string' } } }, 'OTP resent successfully'),
      429: errorResponse('Please wait Ns before requesting another OTP'),
    },
  },
};

paths['/auth/verify-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Verify OTP — logs in, or signs up on first verification',
    description:
      'Send `otp` (the field name the apps use; `code` is accepted as an alias). `role` is optional and defaults to `customer` — the Customer app never sends it; the Delivery app passes `role: "delivery"` explicitly. ' +
      'Self-registration only works for `customer` and `delivery` — a `picker` account with no existing user returns 404 (Pickers are onboarded by Admin only, see POST /admin/pickers, which collects ID-proof documents this endpoint has no way to accept). ' +
      'When registering as `delivery` for the first time, `vehicleType`, `vehicleNumber` and `licenseNumber` are required — a DeliveryProfile is created with `status: "pending"`, same as an admin-created one; the partner cannot accept jobs until an admin approves them (PATCH /admin/delivery-partners/{id}/status). ' +
      'The response\'s `isNewUser` is the single source of truth for whether to route to a "create your profile" screen or straight to Home. ' +
      'On a wrong/expired/exhausted OTP this returns 400 with `errors: [{ reason, attemptsLeft }]` where `reason` is one of `invalid | expired | max_attempts | not_found`, so the UI can show a specific inline message.',
    requestBody: jsonBody({
      ...otpPhoneFields,
      otp: { type: 'string', example: '1234' },
      role: { type: 'string', enum: ['customer', 'delivery'], description: 'Optional, defaults to customer. Only used on first-time signup. (picker is a valid enum value but always 404s — see description.)' },
      name: { type: 'string', example: 'Test Customer' },
      vehicleType: { type: 'string', example: 'bike', description: 'Required when role=delivery on first-time signup' },
      vehicleNumber: { type: 'string', example: 'DL01AB1234', description: 'Required when role=delivery on first-time signup' },
      licenseNumber: { type: 'string', example: 'DL-0420110012345', description: 'Required when role=delivery on first-time signup' },
      deviceId: { type: 'string' },
      platform: { type: 'string', enum: ['android', 'ios', 'web'] },
    }, ['otp']),
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          isNewUser: { type: 'boolean', example: false, description: 'true only on the account\'s very first successful verify-otp' },
          user: ref('User'),
        },
      }, 'Login successful'),
      400: errorResponse('Incorrect OTP, or missing vehicle details for a delivery signup'),
      404: errorResponse('No account found for this number. Please contact your admin. (picker self-registration)'),
    },
  },
};

paths['/auth/refresh'] = {
  post: {
    tags: ['Auth'],
    summary: 'Rotate a refresh token for a new access+refresh token pair',
    requestBody: jsonBody({ refreshToken: { type: 'string' } }, ['refreshToken']),
    responses: {
      200: envelope({ type: 'object', properties: { accessToken: { type: 'string' }, refreshToken: { type: 'string' } } }, 'Token refreshed'),
      401: errorResponse('Invalid or expired refresh token'),
    },
  },
};

paths['/auth/google'] = {
  post: {
    tags: ['Auth'], summary: 'Google login (NOT CONFIGURED — returns 501)',
    requestBody: jsonBody({ idToken: { type: 'string', description: 'ID token from Google Sign-In on the client' } }, ['idToken']),
    responses: { 501: errorResponse('Google login is not configured yet') },
  },
};
paths['/auth/apple'] = {
  post: {
    tags: ['Auth'], summary: 'Apple login (NOT CONFIGURED — returns 501)',
    requestBody: jsonBody({ identityToken: { type: 'string', description: 'Identity token from Sign in with Apple on the client' } }, ['identityToken']),
    responses: { 501: errorResponse('Apple login is not configured yet') },
  },
};

paths['/auth/me'] = {
  get: {
    tags: ['Auth'], summary: 'Get the current logged-in user', ...bearer(),
    responses: { 200: envelope(ref('User')), 401: RESPONSES_401 },
  },
  put: {
    tags: ['Auth'], summary: 'Update the current user\'s profile', ...bearer(),
    requestBody: jsonBody({ name: { type: 'string' }, email: { type: 'string' }, gender: { type: 'string', enum: ['male', 'female', 'other'] }, profileImage: { type: 'string' } }),
    responses: { 200: envelope(ref('User'), 'Profile updated'), 401: RESPONSES_401 },
  },
};

paths['/auth/logout'] = {
  post: {
    tags: ['Auth'], summary: 'Revoke one refresh token (logout this session)', ...bearer(),
    requestBody: jsonBody({ refreshToken: { type: 'string' } }),
    responses: { 200: envelope(null, 'Logged out'), 401: RESPONSES_401 },
  },
};
paths['/auth/logout-all'] = {
  post: {
    tags: ['Auth'], summary: 'Revoke ALL refresh tokens for the current user', ...bearer(),
    responses: { 200: envelope(null, 'Logged out from all sessions'), 401: RESPONSES_401 },
  },
};

// ============================== COMMON ==============================

paths['/common/banners'] = {
  get: { tags: ['Common'], summary: 'List active banners (public)', responses: { 200: envelope({ type: 'array', items: ref('Banner') }) } },
};
paths['/common/upload'] = {
  post: {
    tags: ['Common'], summary: 'Upload a single file (any authenticated role)', ...bearer(),
    requestBody: formBody({ file: { type: 'string', format: 'binary' } }, ['file']),
    responses: { 200: envelope({ type: 'object', properties: { url: { type: 'string', example: '/uploads/172930-image.jpg' } } }, 'File uploaded'), 401: RESPONSES_401 },
  },
};
paths['/common/fcm-token'] = {
  post: {
    tags: ['Common'], summary: 'Register/update the push-notification token for this user', ...bearer(),
    requestBody: jsonBody({ fcmToken: { type: 'string' } }, ['fcmToken']),
    responses: { 200: envelope(null, 'Token registered'), 401: RESPONSES_401 },
  },
};
paths['/common/notifications'] = {
  get: {
    tags: ['Common'], summary: 'List my notifications', ...bearer(), parameters: PAGE_QS,
    responses: { 200: envelope(paginated(ref('Notification'))), 401: RESPONSES_401 },
  },
};
paths['/common/notifications/{id}/read'] = {
  patch: {
    tags: ['Common'], summary: 'Mark one notification as read', ...bearer(), parameters: [idParam()],
    responses: { 200: envelope(ref('Notification')), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/common/notifications/read-all'] = {
  patch: { tags: ['Common'], summary: 'Mark all my notifications as read', ...bearer(), responses: { 200: envelope(null, 'All notifications marked as read'), 401: RESPONSES_401 } },
};
paths['/common/support'] = {
  post: {
    tags: ['Common'], summary: 'Create a support ticket (any role)', ...bearer(),
    requestBody: jsonBody({ subject: { type: 'string' }, message: { type: 'string' } }, ['subject', 'message']),
    responses: { 201: envelope(ref('SupportTicket'), 'Support ticket created'), 401: RESPONSES_401 },
  },
  get: {
    tags: ['Common'], summary: 'List my support tickets', ...bearer(), parameters: PAGE_QS,
    responses: { 200: envelope(paginated(ref('SupportTicket'))), 401: RESPONSES_401 },
  },
};

// ============================== PAYMENTS ==============================

paths['/payments/razorpay/create'] = {
  post: {
    tags: ['Payments'], summary: 'Create a Razorpay order for an existing Grovio order', ...bearer(),
    requestBody: jsonBody({ orderId: { type: 'string' } }, ['orderId']),
    responses: {
      200: envelope({ type: 'object', properties: { razorpayOrderId: { type: 'string' }, amount: { type: 'integer' }, currency: { type: 'string' }, keyId: { type: 'string' }, orderId: { type: 'string' } } }, 'Razorpay order created'),
      401: RESPONSES_401, 404: RESPONSES_404,
    },
  },
};
paths['/payments/razorpay/verify'] = {
  post: {
    tags: ['Payments'], summary: 'Verify a completed Razorpay payment signature', ...bearer(),
    requestBody: jsonBody({
      orderId: { type: 'string' }, razorpayOrderId: { type: 'string' }, razorpayPaymentId: { type: 'string' }, razorpaySignature: { type: 'string' },
    }, ['orderId', 'razorpayOrderId', 'razorpayPaymentId', 'razorpaySignature']),
    responses: { 200: envelope(ref('Order'), 'Payment verified successfully'), 400: errorResponse('Payment signature verification failed'), 401: RESPONSES_401 },
  },
};
paths['/payments/razorpay/webhook'] = {
  post: {
    tags: ['Payments'], summary: 'Razorpay server-to-server webhook (not called by clients)',
    responses: { 200: { description: 'Acknowledged' }, 400: errorResponse('Invalid webhook signature') },
  },
};

module.exports = paths;
