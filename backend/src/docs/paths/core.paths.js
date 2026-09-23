const S = require('../schemas');
const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_403, RESPONSES_404, RESPONSES_422,
  jsonBody, formBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

const paths = {};

// ============================== AUTH ==============================

paths['/auth/register-vendor'] = {
  post: {
    tags: ['Auth'],
    summary: 'Vendor (store-manager) self-registration',
    description:
      'Public signup for a store-manager, as an alternative to an admin creating one via POST /admin/admins. ' +
      'Creates the exact same kind of account a manual creation would (role: admin, manage_own_store_inventory permission, assignedStore) plus a new Store. ' +
      'The store is created with status: "inactive" — it never appears in customer browsing until an admin reviews it and flips it active via PATCH /admin/stores/{id}. That review is the real approval gate; the account itself is fully functional (can manage its own store\'s catalog/inventory/orders) immediately after registering.',
    requestBody: jsonBody({
      name: { type: 'string', example: 'Raj Kirana' },
      email: { type: 'string', example: 'vendor1@grovio.com' },
      password: { type: 'string', example: 'Vendor@123' },
      phone: { type: 'string', example: '9990001111' },
      storeName: { type: 'string', example: 'Raj Kirana - MG Road' },
      address: { type: 'string', example: 'MG Road' },
      lat: { type: 'number', example: 28.6 },
      lng: { type: 'number', example: 77.2 },
      deviceId: { type: 'string' },
      platform: { type: 'string', enum: ['android', 'ios', 'web'] },
    }, ['name', 'email', 'password', 'storeName']),
    responses: {
      201: envelope({
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          user: ref('User'),
          store: ref('Store'),
        },
      }, 'Vendor registered successfully. Your store is pending admin approval.'),
      409: errorResponse('Email or phone number already registered'),
      422: RESPONSES_422,
    },
  },
};

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

// Every OTP endpoint takes just `phone` (10 digits). A non-Indian number can also send `countryCode`
// (defaults to +91) — deliberately left out of the schema so the example body stays one field.
const otpPhoneFields = {
  phone: { type: 'string', example: '9876543210', description: '10-digit mobile number only (country code +91 is assumed)' },
};

paths['/auth/send-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Send OTP to a phone number (Customer/Picker/Delivery login)',
    description: 'Send `{ phone }` — the 10-digit number only (+91 is assumed; pass `countryCode` only for a non-Indian number). Rate-limited server-side: repeat calls within the cooldown window return 429.',
    requestBody: jsonBody(otpPhoneFields, ['phone']),
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
    requestBody: jsonBody(otpPhoneFields, ['phone']),
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
      'Self-registration works for `customer`, `delivery` and `picker` alike. When registering as `delivery` for the first time, `vehicleType`, `vehicleNumber` and `licenseNumber` are required — a DeliveryProfile is created with `status: "pending"`. When registering as `picker` for the first time, a bare account + PickerProfile (`status: "pending"`) is created immediately — no KYC fields are required here. The app\'s onboarding flow collects those afterward in separate steps: PUT /auth/me for name/email/gender/dateOfBirth, then PATCH /picker/kyc-upload (multipart) for ID-proof type/number/document. `idProofType`/`idProofNumber`/`address`/`emergencyContactName`/`emergencyContactPhone` are still accepted here too, purely for a client that wants to submit everything in one call. Either way, the account cannot actually work (accept jobs / get pick-lists assigned) until an admin approves it — see PATCH /admin/delivery-partners/{id}/status and PATCH /admin/pickers/{id}/status. ' +
      'The response\'s `isNewUser` is the single source of truth for whether to route to a "create your profile" screen or straight to Home. ' +
      'On a wrong/expired/exhausted OTP this returns 400 with `errors: [{ reason, attemptsLeft }]` where `reason` is one of `invalid | expired | max_attempts | not_found`, so the UI can show a specific inline message.',
    requestBody: jsonBody({
      ...otpPhoneFields,
      otp: { type: 'string', example: '1234' },
      role: { type: 'string', enum: ['customer', 'delivery', 'picker'], description: 'Optional, defaults to customer. Only used on first-time signup.' },
      name: { type: 'string', example: 'Test Customer' },
      vehicleType: { type: 'string', example: 'bike', description: 'Required when role=delivery on first-time signup' },
      vehicleNumber: { type: 'string', example: 'DL01AB1234', description: 'Required when role=delivery on first-time signup' },
      licenseNumber: { type: 'string', example: 'DL-0420110012345', description: 'Required when role=delivery on first-time signup' },
      idProofType: { type: 'string', example: 'Aadhaar', description: 'Optional, role=picker signup — can instead be filled in later via PATCH /picker/kyc-upload' },
      idProofNumber: { type: 'string', example: '1234-5678-9012', description: 'Optional, role=picker signup — can instead be filled in later via PATCH /picker/kyc-upload' },
      address: { type: 'string', description: 'Optional, role=picker signup' },
      emergencyContactName: { type: 'string', description: 'Optional, role=picker signup' },
      emergencyContactPhone: { type: 'string', description: 'Optional, role=picker signup' },
      deviceId: { type: 'string' },
      platform: { type: 'string', enum: ['android', 'ios', 'web'] },
    }, ['phone', 'otp']),
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
    },
  },
};

// ---------- Picker app auth ----------
const pickerOnboardingSchema = {
  type: 'object',
  description: 'Where the app should route the picker next',
  properties: {
    status: { type: 'string', enum: ['pending', 'approved', 'blocked'] },
    profileComplete: { type: 'boolean', description: 'Name, email, gender and date of birth saved (POST /auth/picker/register)' },
    kycComplete: { type: 'boolean', description: 'ID proof type, number and document uploaded (PATCH /picker/kyc-upload)' },
    nextStep: { type: 'string', enum: ['profile', 'kyc', 'pending_approval', 'home', 'blocked'], example: 'profile' },
  },
};
const pickerOtpSentSchema = {
  type: 'object',
  properties: {
    sent: { type: 'boolean' },
    isRegistered: { type: 'boolean', description: 'false = verifying will create a new picker account' },
    resendCooldownSeconds: { type: 'integer', example: 30 },
    debugOtp: { type: 'string', example: '1234', description: 'Only present when OTP_DEBUG_MODE=true' },
  },
};

paths['/auth/picker/send-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Picker app — send login/signup OTP',
    description: 'Same OTP flow as /auth/send-otp, but only for picker accounts: a number already registered as a customer, delivery partner or admin gets 409, and a disabled picker gets 403, before any SMS is sent.',
    requestBody: jsonBody(otpPhoneFields, ['phone']),
    responses: {
      200: envelope(pickerOtpSentSchema, 'OTP sent successfully'),
      403: errorResponse('Your account has been disabled'),
      409: errorResponse('This number is already registered with a different Grovio account'),
      429: errorResponse('Please wait Ns before requesting another OTP'),
    },
  },
};

paths['/auth/picker/resend-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Picker app — resend OTP (same body/behavior as send-otp, cooldown applies)',
    requestBody: jsonBody(otpPhoneFields, ['phone']),
    responses: {
      200: envelope(pickerOtpSentSchema, 'OTP resent successfully'),
      409: errorResponse('This number is already registered with a different Grovio account'),
      429: errorResponse('Please wait Ns before requesting another OTP'),
    },
  },
};

paths['/auth/picker/verify-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Picker app — verify OTP (logs in, or creates a pending picker on first verification)',
    description:
      'A new number creates a picker account with a PickerProfile in `status: "pending"`. Use `onboarding.nextStep` to route: ' +
      '`profile` → POST /auth/picker/register (name/email/gender/dateOfBirth), `kyc` → PATCH /picker/kyc-upload (ID proof + document), ' +
      '`pending_approval` → waiting screen until an admin approves via PATCH /admin/pickers/{id}/status, `home` → approved, `blocked` → contact support. ' +
      'On a wrong/expired/exhausted OTP this returns 400 with `errors: [{ reason, attemptsLeft }]` (`invalid | expired | max_attempts | not_found`). ' +
      'Token refresh uses the shared /auth/refresh; sign out with /auth/picker/logout.',
    requestBody: jsonBody({
      ...otpPhoneFields,
      otp: { type: 'string', example: '1234' },
      name: { type: 'string', description: 'Optional — can be set later via PUT /auth/me' },
      deviceId: { type: 'string' },
      platform: { type: 'string', enum: ['android', 'ios', 'web'] },
    }, ['phone', 'otp']),
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          isNewUser: { type: 'boolean' },
          user: ref('User'),
          pickerProfile: ref('PickerProfile'),
          onboarding: pickerOnboardingSchema,
        },
      }, 'Login successful'),
      400: errorResponse('Incorrect OTP'),
      403: errorResponse('Your account has been disabled'),
      409: errorResponse('This number is already registered with a different Grovio account'),
    },
  },
};

paths['/auth/picker/me'] = {
  get: {
    tags: ['Auth'],
    summary: 'Picker app — current picker, profile and onboarding step (for splash-screen routing)',
    ...bearer(),
    responses: {
      200: envelope({
        type: 'object',
        properties: { user: ref('User'), pickerProfile: ref('PickerProfile'), onboarding: pickerOnboardingSchema },
      }),
      401: RESPONSES_401,
      403: RESPONSES_403,
    },
  },
};

paths['/auth/picker/register'] = {
  post: {
    tags: ['Auth'],
    summary: 'Picker app — Register step: save name, email, gender and date of birth',
    description:
      'The "Register — Tell us a bit about you" screen shown after OTP signup (`onboarding.nextStep === "profile"`). ' +
      'The mobile number on that screen is read-only: show `user.phone` from verify-otp / GET /auth/picker/me. It is not part of this body. ' +
      '`dateOfBirth` is `DD/MM/YYYY` (ISO `YYYY-MM-DD` also accepted); the picker must be at least 18. `gender` is case-insensitive. ' +
      'Validation errors return 422 with `errors: [{ field, message }]`, so each message can be shown under its input. ' +
      'On success `onboarding.nextStep` becomes `kyc` (→ PATCH /picker/kyc-upload). Can be called again to correct details.',
    ...bearer(),
    requestBody: jsonBody({
      name: { type: 'string', example: 'Ravi Kumar' },
      email: { type: 'string', example: 'ravi.kumar@example.com' },
      gender: { type: 'string', enum: ['male', 'female', 'other'], example: 'male' },
      dateOfBirth: { type: 'string', example: '15/08/1998', description: 'DD/MM/YYYY' },
    }, ['name', 'email', 'gender', 'dateOfBirth']),
    responses: {
      200: envelope({
        type: 'object',
        properties: { user: ref('User'), pickerProfile: ref('PickerProfile'), onboarding: pickerOnboardingSchema },
      }, 'Profile saved'),
      401: RESPONSES_401,
      403: RESPONSES_403,
      409: errorResponse('This email is already used by another account'),
      422: RESPONSES_422,
    },
  },
};

paths['/auth/picker/logout'] = {
  post: {
    tags: ['Auth'],
    summary: 'Picker app — log out this device',
    description: 'Revokes the given refresh token (must belong to the logged-in picker), sets the picker offline and unavailable so no new pick jobs are assigned, and clears the push token. The app should then discard both tokens.',
    ...bearer(),
    requestBody: jsonBody({ refreshToken: { type: 'string' } }, ['refreshToken']),
    responses: {
      200: envelope(null, 'Logged out'),
      400: errorResponse('Invalid or already-revoked refresh token'),
      401: RESPONSES_401,
      403: RESPONSES_403,
    },
  },
};

paths['/auth/picker/logout-all'] = {
  post: {
    tags: ['Auth'],
    summary: 'Picker app — log out from all devices',
    description: 'Revokes every refresh token for this picker, sets them offline and unavailable, and clears the push token.',
    ...bearer(),
    responses: { 200: envelope(null, 'Logged out from all devices'), 401: RESPONSES_401, 403: RESPONSES_403 },
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
    requestBody: jsonBody({ name: { type: 'string' }, email: { type: 'string' }, gender: { type: 'string', enum: ['male', 'female', 'other'] }, profileImage: { type: 'string' }, dateOfBirth: { type: 'string', format: 'date', nullable: true } }),
    responses: { 200: envelope(ref('User'), 'Profile updated'), 400: errorResponse('dateOfBirth must be a valid date'), 401: RESPONSES_401 },
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
paths['/common/content/{slug}'] = {
  get: {
    tags: ['Common'],
    summary: 'Get a static page — About Us, Privacy Policy, or Terms & Conditions (public)',
    description: 'Admin-authored HTML, edited from Admin > Settings > Content Pages. Render the returned `content` field as HTML.',
    parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string', enum: ['about-us', 'privacy-policy', 'terms-and-conditions'] } }],
    responses: { 200: envelope(ref('ContentPage')), 404: RESPONSES_404 },
  },
};
paths['/common/wishlist/{shareToken}'] = {
  get: {
    tags: ['Common'],
    summary: "Read-only view of a customer's shared wishlist (public — reachable once they enable it via POST /customer/wishlist/share)",
    parameters: [{ name: 'shareToken', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: envelope({ type: 'object', properties: { ownerName: { type: 'string', example: 'Rahul' }, items: { type: 'array', items: ref('WishlistItem') } } }),
      404: errorResponse('Shared wishlist not found'),
    },
  },
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
paths['/payments/razorpay/failure'] = {
  post: {
    tags: ['Payments'],
    summary: 'Report a failed/cancelled Razorpay checkout attempt from the client',
    description: 'Call this from the checkout widget\'s failure handler so a failed attempt is recorded instead of leaving the order stuck at paymentStatus "pending". This is a best-effort client report — the payment.failed webhook is the authoritative version and will record the same failure even if the app never calls this (e.g. connectivity lost, app killed). Never downgrades an order that\'s already paid.',
    ...bearer(),
    requestBody: jsonBody({
      orderId: { type: 'string' }, razorpayOrderId: { type: 'string' }, razorpayPaymentId: { type: 'string' }, reason: { type: 'string', example: 'Payment cancelled by user' },
    }, ['orderId', 'razorpayOrderId']),
    responses: { 200: envelope(ref('Order'), 'Payment failure recorded'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/payments/razorpay/webhook'] = {
  post: {
    tags: ['Payments'],
    summary: 'Razorpay server-to-server webhook (not called by clients)',
    description: 'Orders are created with payment_capture: 0 (manual capture), so handles: payment.authorized (re-validates the amount, then explicitly captures via the Capture Payment API — this is the only thing that captures a payment in this app), payment.captured (marks Payment+Order/Wallet paid, records the instrument used), and payment.failed (marks both failed, with failureReason). This is the authoritative source of truth for payment status — the client-side create/verify/failure calls are a faster-feeling optimistic path, but this webhook is what guarantees status is correct even if the client never calls back.',
    responses: { 200: { description: 'Acknowledged' }, 400: errorResponse('Invalid webhook signature') },
  },
};

module.exports = paths;
