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
    summary: 'Vendor (store-manager) self-registration — older path for POST /vendor/auth/register',
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
      'Self-registration works for `customer`, `delivery` and `picker` alike. When registering as `delivery` for the first time, a DeliveryProfile is created with `status: "pending"` (the Delivery app should use /auth/delivery/* instead, which returns the onboarding step; `vehicleType`/`vehicleNumber`/`licenseNumber` are optional here). When registering as `picker` for the first time, a bare account + PickerProfile (`status: "pending"`) is created immediately — no KYC fields are required here. The app\'s onboarding flow collects those afterward in separate steps: PUT /auth/me for name/email/gender/dateOfBirth, then PATCH /picker/kyc-upload (multipart) for ID-proof type/number/document. `idProofType`/`idProofNumber`/`address`/`emergencyContactName`/`emergencyContactPhone` are still accepted here too, purely for a client that wants to submit everything in one call. Either way, the account cannot actually work (accept jobs / get pick-lists assigned) until an admin approves it — see PATCH /admin/delivery-partners/{id}/status and PATCH /admin/pickers/{id}/status. ' +
      'The response\'s `isNewUser` is the single source of truth for whether to route to a "create your profile" screen or straight to Home. ' +
      'On a wrong/expired/exhausted OTP this returns 400 with `errors: [{ reason, attemptsLeft }]` where `reason` is one of `invalid | expired | max_attempts | not_found`, so the UI can show a specific inline message.',
    requestBody: jsonBody({
      ...otpPhoneFields,
      otp: { type: 'string', example: '1234' },
      role: { type: 'string', enum: ['customer', 'delivery', 'picker'], description: 'Optional, defaults to customer. Only used on first-time signup.' },
      name: { type: 'string', example: 'Test Customer' },
      vehicleType: { type: 'string', example: 'bike', description: 'Optional, role=delivery only' },
      vehicleNumber: { type: 'string', example: 'DL01AB1234', description: 'Optional, role=delivery only' },
      licenseNumber: { type: 'string', example: 'DL-0420110012345', description: 'Optional, role=delivery only' },
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
      400: errorResponse('Incorrect OTP'),
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
    description: 'Same OTP flow as /auth/send-otp, but only for picker accounts: it uses the picker account for that number (a customer or delivery account on the same number is separate and untouched), and a disabled picker gets 403, before any SMS is sent.',
    requestBody: jsonBody(otpPhoneFields, ['phone']),
    responses: {
      200: envelope(pickerOtpSentSchema, 'OTP sent successfully'),
      403: errorResponse('Your account has been disabled'),
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

// ---------- Delivery app auth ----------
const deliveryOnboardingSchema = {
  type: 'object',
  description: 'Where the app should route the delivery partner next',
  properties: {
    status: { type: 'string', enum: ['pending', 'approved', 'blocked'] },
    steps: { type: 'object', properties: { vehicle: { type: 'boolean' }, identity: { type: 'boolean' }, addressProof: { type: 'boolean' }, selfie: { type: 'boolean' }, bank: { type: 'boolean' } } },
    completedSteps: { type: 'integer', example: 0 },
    totalSteps: { type: 'integer', example: 5 },
    nextStep: { type: 'string', enum: ['vehicle', 'identity', 'addressProof', 'selfie', 'bank', 'pending_approval', 'home', 'blocked'], example: 'vehicle' },
  },
};
const deliveryOtpSentSchema = {
  ...pickerOtpSentSchema,
  properties: {
    ...pickerOtpSentSchema.properties,
    isRegistered: { type: 'boolean', description: 'false = verifying will create a new delivery partner account' },
  },
};
const deliveryAuthResult = {
  type: 'object',
  properties: { user: ref('User'), deliveryProfile: ref('DeliveryProfile'), onboarding: deliveryOnboardingSchema },
};

paths['/auth/delivery/send-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Delivery app — send login/signup OTP',
    description: 'Same OTP flow as /auth/send-otp, but only for delivery accounts: it uses the delivery account for that number (a customer or picker account on the same number is separate and untouched), and a disabled partner gets 403, before any SMS is sent.',
    requestBody: jsonBody(otpPhoneFields, ['phone']),
    responses: {
      200: envelope(deliveryOtpSentSchema, 'OTP sent successfully'),
      403: errorResponse('Your account has been disabled'),
      429: errorResponse('Please wait Ns before requesting another OTP'),
    },
  },
};

paths['/auth/delivery/resend-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Delivery app — resend OTP (same body/behavior as send-otp, cooldown applies)',
    requestBody: jsonBody(otpPhoneFields, ['phone']),
    responses: {
      200: envelope(deliveryOtpSentSchema, 'OTP resent successfully'),
      429: errorResponse('Please wait Ns before requesting another OTP'),
    },
  },
};

paths['/auth/delivery/verify-otp'] = {
  post: {
    tags: ['Auth'],
    summary: 'Delivery app — verify OTP (logs in, or creates a pending delivery partner on first verification)',
    description:
      'A new number creates a delivery account with a DeliveryProfile in `status: "pending"`. Use `onboarding.nextStep` to route: ' +
      '`vehicle` → PUT /delivery/onboarding/vehicle, `identity` → POST /delivery/onboarding/identity, `addressProof` → POST /delivery/onboarding/address-proof, ' +
      '`selfie` → POST /delivery/onboarding/selfie, `bank` → POST /delivery/onboarding/bank, ' +
      '`pending_approval` → waiting screen until an admin approves via PATCH /admin/delivery-partners/{id}/status, `home` → approved, `blocked` → contact support. ' +
      'On a wrong/expired/exhausted OTP this returns 400 with `errors: [{ reason, attemptsLeft }]` (`invalid | expired | max_attempts | not_found`). ' +
      'Token refresh uses the shared /auth/refresh; sign out with /auth/delivery/logout.',
    requestBody: jsonBody({
      ...otpPhoneFields,
      otp: { type: 'string', example: '1234' },
      name: { type: 'string', description: 'Optional — the name from the PAN/Aadhaar step is used otherwise' },
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
          ...deliveryAuthResult.properties,
        },
      }, 'Login successful'),
      400: errorResponse('Incorrect OTP'),
      403: errorResponse('Your account has been disabled'),
    },
  },
};

paths['/auth/delivery/me'] = {
  get: {
    tags: ['Auth'],
    summary: 'Delivery app — current partner, profile and onboarding step (for splash-screen routing)',
    ...bearer(),
    responses: { 200: envelope(deliveryAuthResult), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
};

paths['/auth/delivery/logout'] = {
  post: {
    tags: ['Auth'],
    summary: 'Delivery app — log out this device',
    description: 'Revokes the given refresh token (must belong to the logged-in partner), sets them unavailable so no new jobs are assigned, and clears the push token. The app should then discard both tokens.',
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

paths['/auth/delivery/logout-all'] = {
  post: {
    tags: ['Auth'],
    summary: 'Delivery app — log out from all devices',
    description: 'Revokes every refresh token for this partner, sets them unavailable, and clears the push token.',
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

paths['/auth/me/profile-image'] = {
  post: {
    tags: ['Auth'],
    summary: 'Upload and set profile picture for current user',
    description: 'Accepts an image file (field name "image" or "file"). Uploads to static server storage, stores the relative path in the user profile, and returns the updated profileImage URL and user object.',
    ...bearer(),
    requestBody: formBody({
      image: { type: 'string', format: 'binary', description: 'Profile picture image file (jpg, png, webp)' },
    }, ['image']),
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          profileImage: { type: 'string', example: '/uploads/1732007890-123456.jpg' },
          user: ref('User'),
        },
      }, 'Profile image updated successfully'),
      400: errorResponse('Image file is required'),
      401: RESPONSES_401,
    },
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
// Support screen: Call support / Chat with us / FAQs (services/support.service.js).
const SUPPORT_TOPIC = { type: 'object', properties: { key: { type: 'string', example: 'payouts' }, label: { type: 'string', example: 'Payouts' }, count: { type: 'integer', example: 2 } } };
const SUPPORT_FAQ = { type: 'object', properties: { _id: { type: 'string' }, topic: { type: 'string', example: 'payouts' }, question: { type: 'string', example: 'When do I get paid?' }, answer: { type: 'string' }, updatedAt: { type: 'string', format: 'date-time' } } };
paths['/common/support/home'] = {
  get: {
    tags: ['Common'], summary: 'Support screen: Call support, Chat with us and FAQs rows, in display order (any app: delivery / picker / customer)', ...bearer(),
    description: [
      'Render `items` as the rows. Each has `key`, `title`, `subtitle` and `enabled` (show the row greyed out when false).',
      '- **call**: dial `dialUrl` (`tel:` + number) from the phone. `subtitle` is the hours ("7 AM – 11 PM"); `isOpenNow` is false outside them (e.g. show "Closed now"). `enabled` is false when no support number is set. Number: setting `deliverySupportPhone` / `pickerSupportPhone` / `customerSupportPhone`, else `supportPhone` (env `SUPPORT_PHONE`); hours: `supportHoursFrom` / `supportHoursTo` (HH:MM, local time, default 07:00–23:00; equal = 24 hours; may cross midnight).',
      '- **chat**: "Average reply in 2 min" — the median time to the first support reply over the last 30 days (needs 5 replied tickets; until then the `supportChatReplyMinutes` setting, default 2). If `activeTicketId` is set, open that conversation (`GET /common/support/{id}`); otherwise start one from `/common/support/categories` + `POST /common/support`.',
      '- **faqs**: `subtitle` lists my app\'s topics ("Payouts, orders, documents"); `topics` have counts. Open `GET /common/support/faqs`. `enabled` is false when there are no FAQs yet.',
    ].join('\n'),
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          title: { type: 'string', example: 'Support' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', enum: ['call', 'chat', 'faqs'] },
                title: { type: 'string', example: 'Call support' },
                subtitle: { type: 'string', example: '7 AM – 11 PM' },
                enabled: { type: 'boolean' },
                phone: { type: 'string', nullable: true, example: '+919876543210', description: 'call' },
                dialUrl: { type: 'string', nullable: true, example: 'tel:+919876543210', description: 'call' },
                hours: { type: 'object', properties: { from: { type: 'string', example: '07:00' }, to: { type: 'string', example: '23:00' } }, description: 'call' },
                isOpenNow: { type: 'boolean', description: 'call' },
                averageReplyMinutes: { type: 'integer', example: 2, description: 'chat' },
                openTickets: { type: 'integer', example: 0, description: 'chat — my unclosed tickets' },
                activeTicketId: { type: 'string', nullable: true, description: 'chat — my latest unclosed ticket' },
                topics: { type: 'array', items: SUPPORT_TOPIC, description: 'faqs' },
              },
            },
          },
        },
      }),
      401: RESPONSES_401,
    },
  },
};
paths['/common/support/faqs'] = {
  get: {
    tags: ['Common'], summary: 'FAQs for my app — all, one topic, or a search over questions and answers', ...bearer(),
    parameters: [q('topic', 'payouts | orders | documents (delivery, picker); orders | payments | account (customer)'), q('q', 'Search text')],
    responses: { 200: envelope({ type: 'object', properties: { topics: { type: 'array', items: SUPPORT_TOPIC }, items: { type: 'array', items: SUPPORT_FAQ } } }), 401: RESPONSES_401 },
  },
};
paths['/common/support/categories'] = {
  get: { tags: ['Common'], summary: 'Help categories and issues for my app (delivery / customer / picker). needsOrder = orderId required.', ...bearer(), responses: { 200: envelope({ type: 'array', items: { type: 'object', properties: { key: { type: 'string', example: 'past_order' }, label: { type: 'string', example: 'Past order related issues' }, needsOrder: { type: 'boolean' }, issues: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', example: 'long_distance_return_pay' }, label: { type: 'string', example: 'Long Distance Return Pay' } } } } } } }), 401: RESPONSES_401 } },
};
paths['/common/support'] = {
  post: {
    tags: ['Common'], summary: 'Create a support ticket (any role). Pick category + subcategory (from /common/support/categories), optionally about an order (Trip details "Help center"), a pocket transfer ("Raise a ticket") or an offer. Older clients may still send just subject + message.', ...bearer(),
    description: 'Live chat: connect Socket.IO to the API origin with auth { token: <accessToken> }. Send with support:send { ticketId, text, clientId? } (ack { ok, message, status, clientId }), support:typing { ticketId, typing }, support:read { ticketId }. Receive support:message, support:ticket, support:typing, support:read for your own tickets — no subscribe needed. These REST endpoints push the same events. See README \"Support Chat\".',
    requestBody: jsonBody({ category: { type: 'string', example: 'past_order' }, subcategory: { type: 'string', example: 'long_distance_return_pay' }, message: { type: 'string' }, orderId: { type: 'string' }, transferId: { type: 'string' }, offerId: { type: 'string' }, subject: { type: 'string', description: 'Only without a category' } }, ['message']),
    responses: { 201: envelope(ref('SupportTicket'), 'Support ticket created'), 401: RESPONSES_401, 404: RESPONSES_404, 422: RESPONSES_422 },
  },
  get: {
    tags: ['Common'], summary: 'List my support tickets (without the conversation). unreadCount is 1 when the last message is an unread support reply.', ...bearer(), parameters: [...PAGE_QS, q('status', 'open | in_progress | resolved | closed')],
    responses: { 200: envelope(paginated(ref('SupportTicket'))), 401: RESPONSES_401 },
  },
};
paths['/common/support/{id}'] = {
  get: { tags: ['Common'], summary: 'A ticket with its conversation (messages: user / agent / system), canReply / canRate / canReopen and unreadCount (support replies I haven\'t read)', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('SupportTicket')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/common/support/{id}/messages'] = {
  post: { tags: ['Common'], summary: 'Reply in the conversation (not once closed — reopen first). Same as the socket\'s support:send; support sees it live.', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ text: { type: 'string' }, clientId: { type: 'string', description: 'Optional: comes back on the support:message event, to match an optimistic bubble' } }, ['text']), responses: { 201: envelope(ref('SupportTicket')), 400: errorResponse('Ticket closed'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/common/support/{id}/read'] = {
  post: { tags: ['Common'], summary: 'I have read the conversation (same as the socket\'s support:read): unreadCount -> 0 and support gets a read receipt', ...bearer(), parameters: [idParam()], responses: { 200: envelope({ type: 'object', properties: { ticketId: { type: 'string' }, readAt: { type: 'string', format: 'date-time' }, unreadCount: { type: 'integer', example: 0 } } }), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/common/support/{id}/rate'] = {
  post: { tags: ['Common'], summary: '"How would you like to rate my assistance?" — after it is closed', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ rating: { type: 'string', enum: ['up', 'down'] } }, ['rating']), responses: { 200: envelope(ref('SupportTicket')), 400: errorResponse('Not closed yet'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/common/support/{id}/reopen'] = {
  post: { tags: ['Common'], summary: '"Still have an issue? Reopen ticket" (optional text is added to the conversation)', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ text: { type: 'string' } }), responses: { 200: envelope(ref('SupportTicket')), 400: errorResponse('Still open'), 401: RESPONSES_401, 404: RESPONSES_404 } },
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

// ============================== ACCOUNT DELETION ==============================
// The same two endpoints in the customer, picker and delivery apps (services/accountDeletion.service.js).

const ACCOUNT_DELETION = {
  customer: {
    removes: 'addresses, cart and wishlist',
    blockers: 'open_orders (an order not yet delivered/cancelled)',
    blockedExample: '1 order(s) still in progress (GRV1024). Try again once they are delivered or cancelled.',
  },
  picker: {
    removes: 'ID proof (number and document), address and emergency contact; the picker is unlinked from their store',
    blockers: 'open_orders (a pick task not yet completed), pending_settlement (a payout still pending)',
    blockedExample: '1 order(s) still in progress (GRV1024). Try again once they are picked or handed to another picker.',
  },
  delivery: {
    removes: 'KYC, address proof, selfies, bank details, vehicle/licence numbers and emergency contact (uploaded documents are deleted); goes offline and upcoming gig bookings are cancelled',
    blockers: 'open_orders (a delivery not yet delivered/returned), cash_in_hand (negative pocket: collected cash not deposited), pending_transfer (a withdrawal/payout in process), cold_bag (a cold bag not returned), pending_settlement',
    blockedExample: 'You still hold ₹230 of collected cash. Deposit it first.',
  },
};

for (const [role, info] of Object.entries(ACCOUNT_DELETION)) {
  paths[`/${role}/account/delete-check`] = {
    get: {
      tags: ['Account deletion'],
      summary: `${role}: what has to be finished before the account can be deleted`,
      description: `Blocker codes: ${info.blockers}. Show each blocker's message. walletBalance (the ${role === 'delivery' ? 'pocket' : 'wallet'}) is not paid out on deletion — warn that a positive balance will be lost.`,
      ...bearer(),
      responses: {
        200: envelope({
          type: 'object',
          properties: {
            canDelete: { type: 'boolean' },
            blockers: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string', example: info.blockedExample } } } },
            walletBalance: { type: 'number', example: 120 },
          },
        }),
        401: RESPONSES_401, 403: RESPONSES_403,
      },
    },
  };
  paths[`/${role}/account`] = {
    delete: {
      tags: ['Account deletion'],
      summary: `${role}: delete my account`,
      description: `Removes devices, sessions, notifications and the name/phone/email/photo, plus ${info.removes}. Past orders, payments and earnings are kept, under "Deleted user". Tokens stop working at once (401) — clear them and go to login. Logging in again with the same number creates a new account. Refused (400, with the blockers in errors[]) while delete-check has blockers.`,
      ...bearer(),
      responses: { 200: envelope(null, 'Your account has been deleted'), 400: errorResponse(info.blockedExample), 401: RESPONSES_401, 403: RESPONSES_403 },
    },
  };
}

module.exports = paths;
