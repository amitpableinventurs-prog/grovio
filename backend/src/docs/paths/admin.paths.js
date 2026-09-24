const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_403, RESPONSES_404, RESPONSES_422,
  jsonBody, formBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

const paths = {};
const TAG_DASH = ['Admin - Dashboard'];
const TAG_USERS = ['Admin - Users'];
const TAG_STORES = ['Admin - Stores'];
const TAG_CATALOG = ['Admin - Catalog'];
const TAG_ORDERS = ['Admin - Orders'];
const TAG_PROMO = ['Admin - Promotions'];
const TAG_SETTINGS = ['Admin - Settings'];
const TAG_REPORTS = ['Admin - Reports'];
const TAG_SUPPORT = ['Admin - Support'];
const TAG_INVENTORY = ['Admin - Inventory'];
const TAG_PAYMENTS = ['Admin - Payments'];
const TAG_SETTLEMENTS = ['Admin - Settlements'];
const TAG_RBAC = ['Admin - RBAC'];

const statusParam = { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by status' };

// ---------- Dashboard ----------
paths['/admin/dashboard'] = {
  get: { tags: TAG_DASH, summary: 'Platform KPIs: GMV, AOV, orders, active stores/pickers/delivery partners', ...bearer(), responses: { 200: envelope(ref('DashboardStats')), 401: RESPONSES_401 } },
};

// ---------- Users by role ----------
function userListPath(role, description) {
  return {
    get: {
      tags: TAG_USERS, summary: `List ${role}s`, description, ...bearer(),
      parameters: [...PAGE_QS, q('search', 'Search by name, phone or email'), statusParam],
      responses: { 200: envelope(paginated(ref('UserWithProfile'))), 401: RESPONSES_401, 403: RESPONSES_403 },
    },
  };
}
paths['/admin/vendors'] = userListPath('vendor', 'Requires manage_vendors permission');
paths['/admin/customers'] = userListPath('customer', 'Requires manage_orders or view_reports permission');
paths['/admin/pickers'] = userListPath('picker', 'Requires manage_pickers permission. Each item also carries `onboarding: { status, profileComplete, kycComplete, nextStep }` — the same object the Picker app gets — so a pending picker can be checked for a complete Register step and KYC upload before approval.');
paths['/admin/pickers'].post = {
  tags: TAG_USERS, summary: 'Onboard a picker directly (created already approved; pickers can also self-register in the app)', ...bearer(),
  requestBody: formBody({
    name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, employeeId: { type: 'string' },
    address: { type: 'string' }, idProofType: { type: 'string' }, idProofNumber: { type: 'string' },
    emergencyContactName: { type: 'string' }, emergencyContactPhone: { type: 'string' },
    joiningDate: { type: 'string', format: 'date' }, shift: { type: 'string' }, assignedStore: { type: 'string' },
    profilePhoto: { type: 'string', format: 'binary' }, idProofDocument: { type: 'string', format: 'binary' },
  }, ['name', 'phone']),
  responses: { 201: envelope({ type: 'object', properties: { user: ref('User'), pickerProfile: ref('PickerProfile') } }, 'Picker created'), 409: errorResponse('A user with this mobile number already exists'), 401: RESPONSES_401 },
};
paths['/admin/pickers/{id}'] = {
  put: {
    tags: TAG_USERS, summary: "Full edit of a picker's profile", ...bearer(), parameters: [idParam('id', 'Picker USER ID')],
    requestBody: formBody({
      name: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' }, idProofType: { type: 'string' },
      idProofNumber: { type: 'string' }, emergencyContactName: { type: 'string' }, emergencyContactPhone: { type: 'string' },
      employeeId: { type: 'string' }, joiningDate: { type: 'string', format: 'date' }, shift: { type: 'string' }, assignedStore: { type: 'string' },
      profilePhoto: { type: 'string', format: 'binary' }, idProofDocument: { type: 'string', format: 'binary' },
    }),
    responses: { 200: envelope({ type: 'object', properties: { user: ref('User'), pickerProfile: ref('PickerProfile') } }, 'Picker updated'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};

paths['/admin/delivery-partners'] = userListPath('delivery', 'Requires manage_delivery permission');
paths['/admin/delivery-partners'].post = {
  tags: TAG_USERS, summary: 'Onboard a delivery partner directly (alongside the existing self-registration path)', ...bearer(),
  requestBody: jsonBody({
    name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
    vehicleType: { type: 'string' }, vehicleNumber: { type: 'string' }, licenseNumber: { type: 'string' },
  }, ['name', 'phone']),
  responses: { 201: envelope({ type: 'object', properties: { user: ref('User'), deliveryProfile: ref('DeliveryProfile') } }, 'Delivery partner created'), 409: errorResponse('A user with this mobile number already exists'), 401: RESPONSES_401 },
};
paths['/admin/delivery-partners/{id}'] = {
  put: {
    tags: TAG_USERS, summary: 'Full edit of a delivery partner', ...bearer(), parameters: [idParam('id', 'Delivery USER ID')],
    requestBody: jsonBody({ name: { type: 'string' }, email: { type: 'string' }, vehicleType: { type: 'string' }, vehicleNumber: { type: 'string' }, licenseNumber: { type: 'string' } }),
    responses: { 200: envelope({ type: 'object', properties: { user: ref('User'), deliveryProfile: ref('DeliveryProfile') } }, 'Delivery partner updated'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
  delete: {
    tags: TAG_USERS, summary: 'Delete a delivery partner (refused if a job is still in progress with them)', ...bearer(), parameters: [idParam('id', 'Delivery USER ID')],
    responses: { 200: envelope(null, 'Delivery partner deleted'), 400: errorResponse('Cannot delete — an order is still in progress with this delivery partner'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};

paths['/admin/users/{id}'] = {
  get: {
    tags: TAG_USERS, summary: 'Get full detail for one user (includes role profile)', ...bearer(), parameters: [idParam('id', 'User ID')],
    responses: { 200: envelope(ref('UserWithProfile')), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};

paths['/admin/vendors/{id}/status'] = {
  patch: {
    tags: TAG_USERS, summary: "Approve/reject/block a vendor's business", ...bearer(), parameters: [idParam('id', 'Vendor USER ID (not Vendor doc id)')],
    requestBody: jsonBody({ status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'blocked'] } }, ['status']),
    responses: { 200: envelope(ref('Vendor'), 'Status updated'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};
paths['/admin/pickers/{id}/status'] = {
  patch: {
    tags: TAG_USERS, summary: 'Approve/block a picker', ...bearer(), parameters: [idParam('id', 'Picker USER ID')],
    requestBody: jsonBody({ status: { type: 'string', enum: ['pending', 'approved', 'blocked'] } }, ['status']),
    responses: { 200: envelope(ref('PickerProfile'), 'Status updated'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};
paths['/admin/pickers/{id}/assign-store'] = {
  patch: {
    tags: TAG_USERS, summary: 'Link a picker to the store they pick for', ...bearer(), parameters: [idParam('id', 'Picker USER ID')],
    requestBody: jsonBody({ storeId: { type: 'string' } }, ['storeId']),
    responses: { 200: envelope(ref('PickerProfile'), 'Picker linked to store'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};
paths['/admin/delivery-partners/{id}/status'] = {
  patch: {
    tags: TAG_USERS, summary: 'Approve/block a delivery partner', ...bearer(), parameters: [idParam('id', 'Delivery USER ID')],
    requestBody: jsonBody({ status: { type: 'string', enum: ['pending', 'approved', 'blocked'] } }, ['status']),
    responses: { 200: envelope(ref('DeliveryProfile'), 'Status updated'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};
paths['/admin/users/{id}/active'] = {
  patch: {
    tags: TAG_USERS, summary: 'Enable/disable a user\'s login (any role)', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ isActive: { type: 'boolean' } }, ['isActive']),
    responses: { 200: envelope(ref('User')), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};

// ---------- Stores ----------
paths['/admin/stores'] = {
  get: {
    tags: TAG_STORES, summary: 'List all stores platform-wide', ...bearer(),
    parameters: [...PAGE_QS, q('vendorId', 'Filter by vendor'), q('status', 'active | inactive'), q('zoneId', 'Filter by zone')],
    responses: { 200: envelope(paginated(ref('Store'))), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
};
paths['/admin/stores/{id}'] = {
  get: {
    tags: TAG_STORES, summary: 'Get one store', ...bearer(), parameters: [idParam()],
    responses: { 200: envelope(ref('Store')), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
  patch: {
    tags: TAG_STORES, summary: 'Update a store\'s zone/timings/status', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ zoneId: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive'] }, openTime: { type: 'string' }, closeTime: { type: 'string' } }),
    responses: { 200: envelope(ref('Store'), 'Store updated'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};

const HUB_DISPLAY = {
  type: 'object',
  properties: {
    _id: { type: 'string' }, store: { type: 'string' }, name: { type: 'string', example: 'Pickup counter TV' },
    lastSeenAt: { type: 'string', format: 'date-time', nullable: true }, revokedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};
paths['/admin/stores/{id}/hub-displays'] = {
  get: {
    tags: TAG_STORES, summary: 'List this store\'s hub screens (/hub-display), revoked ones included', ...bearer(), parameters: [idParam()],
    responses: { 200: envelope({ type: 'array', items: HUB_DISPLAY }), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
  post: {
    tags: TAG_STORES,
    summary: 'Add a hub screen — returns its one-time pairing link (<PUBLIC_BASE_URL>/hub-display/#key=...); the key is never shown again',
    ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ name: { type: 'string', example: 'Pickup counter TV' } }, ['name']),
    responses: { 201: envelope({ type: 'object', properties: { display: HUB_DISPLAY, pairingUrl: { type: 'string' } } }, 'Hub screen created'), 400: errorResponse('name is required'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};
paths['/admin/hub-displays/{id}'] = {
  delete: {
    tags: TAG_STORES, summary: 'Revoke a hub screen — its key and QR stop working and its live connection is dropped', ...bearer(), parameters: [idParam()],
    responses: { 200: envelope(HUB_DISPLAY, 'Hub screen revoked'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};

// ---------- Catalog ----------
paths['/admin/categories'] = {
  post: {
    tags: TAG_CATALOG, summary: 'Create a category', ...bearer(),
    requestBody: formBody({ name: { type: 'string' }, parentId: { type: 'string' }, status: { type: 'string' }, image: { type: 'string', format: 'binary' } }, ['name']),
    responses: { 201: envelope(ref('Category'), 'Category created'), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
  get: {
    tags: TAG_CATALOG, summary: 'List categories (tree: parents with children[])', ...bearer(),
    responses: { 200: envelope({ type: 'array', items: ref('Category') }), 401: RESPONSES_401 },
  },
};
paths['/admin/categories/{id}'] = {
  patch: {
    tags: TAG_CATALOG, summary: 'Update a category', ...bearer(), parameters: [idParam()],
    requestBody: formBody({ name: { type: 'string' }, parentId: { type: 'string' }, status: { type: 'string' }, image: { type: 'string', format: 'binary' } }),
    responses: { 200: envelope(ref('Category'), 'Category updated'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
  delete: {
    tags: TAG_CATALOG, summary: 'Delete a category', ...bearer(), parameters: [idParam()],
    responses: { 200: envelope(null, 'Category deleted'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
const adminProductFields = { storeId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, categoryId: { type: 'string' }, unit: { type: 'string' }, price: { type: 'number' }, discountPrice: { type: 'number' }, stockQty: { type: 'integer' }, sku: { type: 'string' }, isAvailable: { type: 'boolean' }, status: { type: 'string', enum: ['active', 'inactive'] }, images: { type: 'array', items: { type: 'string', format: 'binary' } } };

paths['/admin/products'] = {
  get: {
    tags: TAG_CATALOG, summary: 'List/moderate products across all stores', ...bearer(),
    parameters: [...PAGE_QS, q('status', 'active | inactive'), q('storeId'), q('vendorId')],
    responses: { 200: envelope(paginated(ref('Product'))), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
  post: {
    tags: TAG_CATALOG, summary: 'Create a product under any store (admin support/onboarding use case)', ...bearer(),
    requestBody: formBody(adminProductFields, ['storeId', 'name', 'categoryId', 'unit', 'price']),
    responses: { 201: envelope(ref('Product'), 'Product created'), 401: RESPONSES_401, 404: errorResponse('Store not found') },
  },
};
paths['/admin/products/{id}'] = {
  patch: {
    tags: TAG_CATALOG, summary: 'Full edit of a product (any field, any store)', ...bearer(), parameters: [idParam()],
    requestBody: formBody(adminProductFields),
    responses: { 200: envelope(ref('Product'), 'Product updated'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
  delete: {
    tags: TAG_CATALOG, summary: 'Delete a product', ...bearer(), parameters: [idParam()],
    responses: { 200: envelope(null, 'Product deleted'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/admin/products/{id}/status'] = {
  patch: {
    tags: TAG_CATALOG, summary: 'Activate/deactivate a product (quick toggle)', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ status: { type: 'string', enum: ['active', 'inactive'] } }, ['status']),
    responses: { 200: envelope(ref('Product'), 'Product status updated'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};

// ---------- Orders ----------
paths['/admin/orders'] = {
  get: {
    tags: TAG_ORDERS, summary: 'List/search all orders', ...bearer(),
    parameters: [...PAGE_QS, statusParam, q('vendorId'), q('storeId')],
    responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
};
paths['/admin/orders/{id}'] = {
  get: {
    tags: TAG_ORDERS, summary: 'Get full order detail', ...bearer(), parameters: [idParam()],
    responses: { 200: envelope(ref('Order')), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/admin/orders/{id}/assign-picker'] = {
  patch: {
    tags: TAG_ORDERS,
    summary: 'Manually reassign ONE item to a (possibly new) picker',
    description: "The automatic 3-way split at order acceptance (see assignment.service.js#splitOrderAcrossPickers) is the default — this is for rebalancing afterward, e.g. a picker goes offline mid-order. Creates a pickTask for the target picker if they weren't already on this order.",
    ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ itemId: { type: 'string' }, pickerId: { type: 'string' } }, ['itemId', 'pickerId']),
    responses: { 200: envelope(ref('Order'), 'Item reassigned'), 400: errorResponse('Picker not found or not approved'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/admin/orders/{id}/assign-delivery'] = {
  patch: {
    tags: TAG_ORDERS, summary: 'Manually assign/reassign a delivery partner to an order', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ deliveryId: { type: 'string' } }, ['deliveryId']),
    responses: { 200: envelope(ref('Order'), 'Delivery partner assigned'), 400: errorResponse('Delivery partner not found or not approved'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/admin/orders/{id}/cancel'] = {
  patch: {
    tags: TAG_ORDERS, summary: 'Cancel an in-flight order (any state before out_for_delivery, or before delivered)', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ reason: { type: 'string' } }),
    responses: { 200: envelope(ref('Order'), 'Order cancelled'), 400: errorResponse("Cannot move order from '<status>' to 'cancelled'"), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/admin/orders/{id}/mark-returned'] = {
  patch: {
    tags: TAG_ORDERS, summary: "Admin equivalent of the Delivery Boy's RTO-complete action — only valid from delivery_failed", ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ reason: { type: 'string' } }, ['reason']),
    responses: { 200: envelope(ref('Order'), 'Order marked as returned'), 400: errorResponse("Cannot move order from '<status>' to 'returned' — only allowed from delivery_failed"), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};
paths['/admin/orders/{id}/refund'] = {
  post: {
    tags: TAG_ORDERS, summary: 'Issue a manual/partial refund to the customer\'s wallet', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ amount: { type: 'number' }, reason: { type: 'string' } }, ['amount', 'reason']),
    responses: { 201: envelope(ref('Refund'), 'Refund issued'), 400: errorResponse('Invalid amount/reason'), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
};

paths['/admin/scanner-logs'] = {
  get: {
    tags: TAG_ORDERS, summary: 'List handover QR scan attempts (success and failure) — see /delivery/jobs/{id}/scan', ...bearer(),
    parameters: [...PAGE_QS, q('orderId'), q('status', 'success | failed'), q('userType', 'picker | delivery')],
    responses: { 200: envelope(paginated(ref('ScannerLog'))), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
};

// ---------- Promotions: Coupons ----------
const couponBody = {
  code: { type: 'string', example: 'WELCOME50' },
  discountType: { type: 'string', enum: ['flat', 'percent'] },
  discountValue: { type: 'number' },
  minOrderAmount: { type: 'number' },
  maxDiscount: { type: 'number' },
  validFrom: { type: 'string', format: 'date-time' },
  validTo: { type: 'string', format: 'date-time' },
  usageLimit: { type: 'integer' },
  perUserLimit: { type: 'integer' },
  isActive: { type: 'boolean' },
};
paths['/admin/coupons'] = {
  post: { tags: TAG_PROMO, summary: 'Create a platform-wide coupon', ...bearer(), requestBody: jsonBody(couponBody, ['code', 'discountType', 'discountValue']), responses: { 201: envelope(ref('Coupon'), 'Coupon created'), 401: RESPONSES_401 } },
  get: { tags: TAG_PROMO, summary: 'List all coupons', ...bearer(), responses: { 200: envelope({ type: 'array', items: ref('Coupon') }), 401: RESPONSES_401 } },
};
paths['/admin/coupons/{id}'] = {
  patch: { tags: TAG_PROMO, summary: 'Update a coupon', ...bearer(), parameters: [idParam()], requestBody: jsonBody(couponBody), responses: { 200: envelope(ref('Coupon'), 'Coupon updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
  delete: { tags: TAG_PROMO, summary: 'Delete a coupon', ...bearer(), parameters: [idParam()], responses: { 200: envelope(null, 'Coupon deleted'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

// ---------- Promotions: Banners ----------
const bannerFields = { title: { type: 'string' }, linkType: { type: 'string', enum: ['product', 'category', 'vendor', 'url', 'none'] }, linkValue: { type: 'string' }, position: { type: 'integer' }, isActive: { type: 'boolean' }, image: { type: 'string', format: 'binary' } };
paths['/admin/banners'] = {
  post: { tags: TAG_PROMO, summary: 'Create a banner', ...bearer(), requestBody: formBody(bannerFields, ['image']), responses: { 201: envelope(ref('Banner'), 'Banner created'), 401: RESPONSES_401 } },
  get: { tags: TAG_PROMO, summary: 'List all banners', ...bearer(), responses: { 200: envelope({ type: 'array', items: ref('Banner') }), 401: RESPONSES_401 } },
};
paths['/admin/banners/{id}'] = {
  patch: { tags: TAG_PROMO, summary: 'Update a banner', ...bearer(), parameters: [idParam()], requestBody: formBody(bannerFields), responses: { 200: envelope(ref('Banner'), 'Banner updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
  delete: { tags: TAG_PROMO, summary: 'Delete a banner', ...bearer(), parameters: [idParam()], responses: { 200: envelope(null, 'Banner deleted'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

// ---------- Settings ----------
paths['/admin/orders/{id}/accept'] = {
  patch: {
    tags: TAG_ORDERS, summary: 'Accept an incoming (placed) order — used by the Live Orders board; splits it to pickers', ...bearer(), parameters: [idParam()],
    responses: { 200: envelope(ref('Order'), 'Order accepted'), 400: errorResponse('Not in placed state, or an online order still waiting for payment'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};
paths['/admin/orders/{id}/reject'] = {
  patch: {
    tags: TAG_ORDERS, summary: 'Reject an incoming (placed) order — refunds to the customer wallet if already paid', ...bearer(), parameters: [idParam()],
    requestBody: jsonBody({ reason: { type: 'string', example: 'Store closing early' } }),
    responses: { 200: envelope(ref('Order'), 'Order rejected'), 401: RESPONSES_401, 403: RESPONSES_403, 404: RESPONSES_404 },
  },
};

const ChargeConfig = {
  type: 'object',
  properties: {
    delivery: { type: 'object', properties: {
      enabled: { type: 'boolean' },
      type: { type: 'string', enum: ['fixed', 'percent'], description: 'fixed = ₹ amount, percent = % of item total' },
      value: { type: 'number' },
      freeAbove: { type: 'number', description: 'Waive delivery when item total ≥ this. 0 = never free' },
    } },
    handling: { type: 'object', properties: {
      enabled: { type: 'boolean' },
      type: { type: 'string', enum: ['fixed', 'percent'], description: 'fixed = ₹ amount, percent = % of item total' },
      value: { type: 'number' },
    } },
    packing: { type: 'object', properties: {
      enabled: { type: 'boolean' },
      type: { type: 'string', enum: ['fixed', 'percent'], description: 'fixed = ₹ amount, percent = % of item total' },
      value: { type: 'number' },
    } },
    surcharge: { type: 'object', properties: {
      enabled: { type: 'boolean' },
      type: { type: 'string', enum: ['fixed', 'percent'], description: 'fixed = ₹ amount, percent = % of item total' },
      value: { type: 'number' },
      label: { type: 'string', example: 'Rain surcharge', description: 'Shown to customers' },
    } },
  },
};
paths['/admin/charges'] = {
  get: {
    tags: TAG_SETTINGS, summary: 'Get order charges — delivery, handling, packing, surcharge', ...bearer(),
    description: 'Charges are applied once per order at checkout. Each is a fixed ₹ amount or a % of the item total (before coupon discount).',
    responses: { 200: envelope(ChargeConfig), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
  put: {
    tags: TAG_SETTINGS, summary: 'Save order charges (applies to new checkouts only)', ...bearer(),
    requestBody: { required: true, content: { 'application/json': { schema: ChargeConfig, example: {
      delivery: { enabled: true, type: 'fixed', value: 30, freeAbove: 499 },
      handling: { enabled: true, type: 'fixed', value: 5 },
      packing: { enabled: true, type: 'percent', value: 2 },
      surcharge: { enabled: false, type: 'fixed', value: 20, label: 'Rain surcharge' },
    } } } },
    responses: { 200: envelope(ChargeConfig, 'Charges saved'), 401: RESPONSES_401, 403: RESPONSES_403, 422: RESPONSES_422 },
  },
};
paths['/admin/order-settings'] = {
  get: {
    tags: TAG_ORDERS, summary: 'Live Orders board settings', ...bearer(),
    responses: { 200: envelope({ type: 'object', properties: { autoAcceptOrders: { type: 'boolean' } } }), 401: RESPONSES_401, 403: RESPONSES_403 },
  },
  put: {
    tags: TAG_ORDERS, summary: 'Turn auto-accept on/off (off = orders wait on the Live Orders board)', ...bearer(),
    requestBody: jsonBody({ autoAcceptOrders: { type: 'boolean' } }, ['autoAcceptOrders']),
    responses: { 200: envelope({ type: 'object', properties: { autoAcceptOrders: { type: 'boolean' } } }), 401: RESPONSES_401, 403: RESPONSES_403, 422: RESPONSES_422 },
  },
};

paths['/admin/settings'] = {
  get: {
    tags: TAG_SETTINGS,
    summary: 'Get all app settings as a key-value map',
    description: 'Secret keys (razorpayKeySecret, razorpayWebhookSecret, smsApiKey, smsApiSecret, googleMapsApiKey) come back masked to their last 4 characters, or null if never set — never the real value. These credentials override the equivalent .env vars at runtime (see settings.service.js) without a restart.',
    ...bearer(),
    responses: {
      200: envelope({
        type: 'object', additionalProperties: { type: 'string', nullable: true },
        example: {
          deliveryFee: '25', commissionPercent: '10', minOrderAmount: '0', appVersion: '1.0.0',
          razorpayKeyId: 'rzp_live_abc123', razorpayKeySecret: '••••1234', razorpayWebhookSecret: null,
          smsProvider: 'msg91', smsApiKey: '••••wxyz', smsSenderId: 'GROVIO', smsTemplateId: 'flow_123',
          googleMapsApiKey: null,
        },
      }),
      401: RESPONSES_401,
    },
  },
  put: {
    tags: TAG_SETTINGS,
    summary: 'Upsert one or more settings',
    description: "A blank/omitted value for a secret key (see GET above) is treated as \"leave unchanged\", not \"clear it\" — this lets the Settings page submit real edits alongside untouched secret fields left empty.",
    ...bearer(),
    requestBody: jsonBody({
      deliveryFee: { type: 'string' }, commissionPercent: { type: 'string' }, minOrderAmount: { type: 'string' }, appVersion: { type: 'string' },
      razorpayKeyId: { type: 'string' }, razorpayKeySecret: { type: 'string', description: 'Omit/blank to keep existing' }, razorpayWebhookSecret: { type: 'string', description: 'Omit/blank to keep existing' },
      smsProvider: { type: 'string', enum: ['none', 'msg91', 'twilio'] },
      smsApiKey: { type: 'string', description: 'MSG91 auth key or Twilio Account SID — omit/blank to keep existing' },
      smsApiSecret: { type: 'string', description: 'Twilio Auth Token only — omit/blank to keep existing' },
      smsSenderId: { type: 'string', description: 'MSG91 sender ID or Twilio From number' },
      smsTemplateId: { type: 'string', description: 'MSG91 DLT flow/template ID' },
      googleMapsApiKey: { type: 'string', description: 'Omit/blank to keep existing' },
    }),
    responses: { 200: envelope({ type: 'object' }, 'Settings updated'), 401: RESPONSES_401 },
  },
};

paths['/admin/content-pages'] = {
  get: { tags: TAG_SETTINGS, summary: 'List all content pages (About Us, Privacy Policy, Terms & Conditions)', ...bearer(), responses: { 200: envelope({ type: 'array', items: ref('ContentPage') }), 401: RESPONSES_401 } },
};
paths['/admin/content-pages/{slug}'] = {
  get: {
    tags: TAG_SETTINGS, summary: 'Get one content page', ...bearer(),
    parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string', enum: ['about-us', 'privacy-policy', 'terms-and-conditions'] } }],
    responses: { 200: envelope(ref('ContentPage')), 401: RESPONSES_401, 404: RESPONSES_404 },
  },
  put: {
    tags: TAG_SETTINGS, summary: 'Update a content page (creates it if it somehow doesn\'t exist yet)', ...bearer(),
    parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string', enum: ['about-us', 'privacy-policy', 'terms-and-conditions'] } }],
    requestBody: jsonBody({ title: { type: 'string' }, content: { type: 'string', description: 'HTML' } }, ['title', 'content']),
    responses: { 200: envelope(ref('ContentPage'), 'Page updated'), 400: errorResponse('title and content are required'), 401: RESPONSES_401 },
  },
};

// ---------- Reports ----------
paths['/admin/reports/sales'] = {
  get: { tags: TAG_REPORTS, summary: 'Sales totals (delivered orders)', ...bearer(), parameters: [q('from', 'ISO date'), q('to', 'ISO date')], responses: { 200: envelope({ type: 'object', properties: { totalOrders: { type: 'integer' }, totalRevenue: { type: 'number' }, totalItemSales: { type: 'number' } } }), 401: RESPONSES_401 } },
};
paths['/admin/reports/vendor-commission'] = {
  get: { tags: TAG_REPORTS, summary: 'Per-vendor sales, commission and payout amounts', ...bearer(), responses: { 200: envelope({ type: 'array', items: { type: 'object', properties: { vendorId: { type: 'string' }, businessName: { type: 'string' }, totalOrders: { type: 'integer' }, totalSales: { type: 'number' }, commissionPercent: { type: 'number' }, commissionAmount: { type: 'number' }, payoutAmount: { type: 'number' } } } }), 401: RESPONSES_401 } },
};
paths['/admin/reports/products'] = {
  get: { tags: TAG_REPORTS, summary: 'Best-selling products platform-wide', ...bearer(), parameters: [q('limit', 'default 20', { type: 'integer' })], responses: { 200: envelope({ type: 'array', items: { type: 'object', properties: { _id: { type: 'string' }, name: { type: 'string' }, qtySold: { type: 'integer' }, revenue: { type: 'number' } } } }), 401: RESPONSES_401 } },
};
paths['/admin/reports/customers'] = {
  get: { tags: TAG_REPORTS, summary: 'Top customers by spend', ...bearer(), parameters: [q('limit', 'default 20', { type: 'integer' })], responses: { 200: envelope({ type: 'array', items: { type: 'object', properties: { customerId: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' }, totalOrders: { type: 'integer' }, totalSpend: { type: 'number' } } } }), 401: RESPONSES_401 } },
};
paths['/admin/reports/delivery-partners'] = {
  get: { tags: TAG_REPORTS, summary: 'Completed deliveries + fees earned per delivery partner', ...bearer(), responses: { 200: envelope({ type: 'array', items: { type: 'object', properties: { deliveryPartnerId: { type: 'string' }, name: { type: 'string' }, phone: { type: 'string' }, totalDeliveries: { type: 'integer' }, totalDeliveryFees: { type: 'number' } } } }), 401: RESPONSES_401 } },
};

// ---------- Support ----------
paths['/admin/support-tickets'] = {
  get: { tags: TAG_SUPPORT, summary: 'List all support tickets', ...bearer(), parameters: [...PAGE_QS, statusParam], responses: { 200: envelope(paginated(ref('SupportTicket'))), 401: RESPONSES_401 } },
};
paths['/admin/support-tickets/{id}'] = {
  patch: { tags: TAG_SUPPORT, summary: 'Reply to / change status of a ticket', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ adminReply: { type: 'string' }, status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] } }), responses: { 200: envelope(ref('SupportTicket'), 'Ticket updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

// ---------- Inventory ----------
paths['/admin/inventory'] = {
  get: {
    tags: TAG_INVENTORY, summary: 'Stock levels across stores, with a low-stock filter', ...bearer(),
    parameters: [...PAGE_QS, q('storeId'), q('lowStock', "'true' to filter"), q('threshold', 'default 5', { type: 'integer' })],
    responses: { 200: envelope(paginated(ref('Product'))), 401: RESPONSES_401 },
  },
};
paths['/admin/inventory/export'] = {
  get: {
    tags: TAG_INVENTORY, summary: 'Export inventory as a CSV file', ...bearer(),
    description: 'Columns: productId, sku, name, store, category, price, discountPrice, stockQty, isAvailable, status. store/category/name are for readability only — re-importing this file only ever uses productId to match rows back to products.',
    parameters: [q('storeId')],
    responses: { 200: { description: 'CSV file (text/csv)', content: { 'text/csv': { schema: { type: 'string' } } } }, 401: RESPONSES_401 },
  },
};
paths['/admin/inventory/import'] = {
  post: {
    tags: TAG_INVENTORY, summary: 'Bulk-update stock/price/availability from a CSV file (same shape as the export)', ...bearer(),
    description: 'Only stockQty, price, discountPrice, isAvailable, and status are applied — name/store/category columns are ignored so a bad row can never relocate or rename a product. Rows are matched by productId; unmatched/invalid rows are reported per-row rather than failing the whole import.',
    requestBody: formBody({ file: { type: 'string', format: 'binary', description: 'CSV file' } }, ['file']),
    responses: {
      200: envelope({ type: 'object', properties: { updated: { type: 'integer' }, errors: { type: 'array', items: { type: 'object', properties: { row: { type: 'integer' }, productId: { type: 'string' }, message: { type: 'string' } } } } } }, 'Import summary'),
      400: errorResponse('A CSV file is required'), 401: RESPONSES_401,
    },
  },
};

// ---------- Payments / Refunds ----------
paths['/admin/payments'] = {
  get: { tags: TAG_PAYMENTS, summary: 'List all payment records', ...bearer(), parameters: [...PAGE_QS, statusParam, q('method'), q('instrument', 'card | upi | netbanking | wallet | emi — only meaningful for method=RAZORPAY'), q('purpose', 'order | wallet_topup')], responses: { 200: envelope(paginated(ref('Payment'))), 401: RESPONSES_401 } },
};
paths['/admin/payments/cod-reconciliation'] = {
  get: {
    tags: TAG_PAYMENTS, summary: 'Reconcile delivered COD orders — splits what was collected as physical cash (needs settling) vs UPI (already digital)', ...bearer(),
    parameters: [q('from'), q('to'), q('collectionMethod', 'cash | upi')],
    responses: {
      200: envelope({
        type: 'object',
        properties: {
          totalOrders: { type: 'integer' }, totalCollected: { type: 'number' },
          cashCollected: { type: 'number' }, upiCollected: { type: 'number' },
          unsettledCount: { type: 'integer' }, unsettledCashCount: { type: 'integer' },
          orders: { type: 'array', items: { type: 'object' } },
        },
      }),
      401: RESPONSES_401,
    },
  },
};
paths['/admin/refunds'] = {
  get: { tags: TAG_PAYMENTS, summary: 'List all refunds', ...bearer(), parameters: [...PAGE_QS, statusParam], responses: { 200: envelope(paginated(ref('Refund'))), 401: RESPONSES_401 } },
};

// ---------- Settlements ----------
paths['/admin/settlements/generate'] = {
  post: {
    tags: TAG_SETTLEMENTS, summary: 'Bundle a vendor\'s unsettled delivered orders into a payable settlement', ...bearer(),
    requestBody: jsonBody({ vendorId: { type: 'string' }, from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } }, ['vendorId']),
    responses: { 201: envelope(ref('Settlement'), 'Settlement generated'), 400: errorResponse('No unsettled delivered orders found'), 401: RESPONSES_401 },
  },
};
paths['/admin/settlements'] = {
  get: { tags: TAG_SETTLEMENTS, summary: 'List settlements', ...bearer(), parameters: [...PAGE_QS, statusParam, q('payeeRole'), q('vendorId')], responses: { 200: envelope(paginated(ref('Settlement'))), 401: RESPONSES_401 } },
};
paths['/admin/settlements/{id}/pay'] = {
  patch: { tags: TAG_SETTLEMENTS, summary: 'Mark a settlement paid (debits the payee\'s wallet)', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Settlement'), 'Settlement marked as paid'), 400: errorResponse('Already paid'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

// ---------- RBAC ----------
paths['/admin/admins'] = {
  post: {
    tags: TAG_RBAC, summary: 'Create a staff admin with specific permissions', ...bearer(),
    requestBody: jsonBody({ name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } }, ['name', 'email', 'password', 'permissions']),
    responses: { 201: envelope(ref('User'), 'Admin created'), 401: RESPONSES_401, 409: errorResponse('Email already registered') },
  },
  get: { tags: TAG_RBAC, summary: 'List all admin accounts', ...bearer(), parameters: PAGE_QS, responses: { 200: envelope(paginated(ref('User'))), 401: RESPONSES_401 } },
};
paths['/admin/admins/{id}/permissions'] = {
  patch: { tags: TAG_RBAC, summary: 'Replace a staff admin\'s permission list', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ permissions: { type: 'array', items: { type: 'string' } } }, ['permissions']), responses: { 200: envelope(ref('User'), 'Permissions updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/admin/activity-logs'] = {
  get: { tags: TAG_RBAC, summary: 'Audit log of sensitive admin actions', ...bearer(), parameters: [...PAGE_QS, q('adminId'), q('action')], responses: { 200: envelope(paginated(ref('AdminActivityLog'))), 401: RESPONSES_401 } },
};

module.exports = paths;
