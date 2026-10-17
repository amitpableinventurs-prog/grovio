const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_404, RESPONSES_422,
  jsonBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

// Vendor Panel API (routes/vendor.routes.js). A vendor is a store-manager account (role admin with
// only manage_own_store_inventory + assignedStore); everything below is locked to their store.
const paths = {};
const TAG = ['Vendor'];
const NOT_VENDOR = errorResponse('Not a vendor (store) account — admins use the admin panel');
const guarded = { 401: RESPONSES_401, 403: NOT_VENDOR };

const SESSION = {
  type: 'object',
  properties: { accessToken: { type: 'string' }, refreshToken: { type: 'string' }, user: ref('User'), store: ref('Store') },
};

paths['/vendor/auth/register'] = {
  post: {
    tags: TAG,
    summary: 'Vendor self-registration (the /vendor-signup page). Creates the store-manager account and a new store with status "inactive" — hidden from customers until an admin activates it (PATCH /admin/stores/{id}). The account can manage its catalog straight away.',
    requestBody: jsonBody({
      name: { type: 'string', example: 'Raj Kirana' },
      email: { type: 'string', example: 'vendor1@grovio.com' },
      password: { type: 'string', example: 'Vendor@123' },
      phone: { type: 'string', example: '9990001111' },
      storeName: { type: 'string', example: 'Raj Kirana - MG Road' },
      address: { type: 'string', example: 'MG Road' },
      lat: { type: 'number', example: 22.72 },
      lng: { type: 'number', example: 75.87 },
    }, ['name', 'email', 'password', 'storeName']),
    responses: { 201: envelope(SESSION, 'Vendor registered successfully. Your store is pending admin approval.'), 409: errorResponse('Email or phone number already registered'), 422: RESPONSES_422 },
  },
};
paths['/vendor/auth/login'] = {
  post: {
    tags: TAG,
    summary: 'Vendor Panel login (email + password). Only vendor accounts get in. Refresh and logout use POST /auth/refresh and /auth/logout.',
    requestBody: jsonBody({ email: { type: 'string', example: 'vendor1@grovio.com' }, password: { type: 'string', example: 'Vendor@123' } }, ['email', 'password']),
    responses: { 200: envelope(SESSION, 'Login successful'), 401: errorResponse('Invalid email or password'), 403: errorResponse('Account disabled, or not a vendor account') },
  },
};
paths['/vendor/me'] = {
  get: { tags: TAG, summary: 'My account and my store (store.status "inactive" = waiting for admin approval)', ...bearer(), responses: { 200: envelope({ type: 'object', properties: { user: ref('User'), store: ref('Store') } }), ...guarded } },
};
paths['/vendor/store'] = {
  get: { tags: TAG, summary: 'My store. Read-only: the admin sets its details and approval.', ...bearer(), responses: { 200: envelope(ref('Store')), ...guarded, 404: RESPONSES_404 } },
};
paths['/vendor/dashboard'] = {
  get: { tags: TAG, summary: 'Same stats as GET /admin/dashboard, for my store only', ...bearer(), parameters: [q('range', 'today | 7d | 30d | 90d (default 30d)')], responses: { 200: envelope({ type: 'object' }), ...guarded } },
};

paths['/vendor/categories'] = {
  get: { tags: TAG, summary: 'Category tree to file products under (managed by the admin)', ...bearer(), responses: { 200: envelope({ type: 'array', items: ref('Category') }), ...guarded } },
};
const productForm = {
  content: {
    'multipart/form-data': {
      schema: {
        type: 'object',
        properties: {
          categoryId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, unit: { type: 'string', example: 'pcs' },
          price: { type: 'number' }, discountPrice: { type: 'number' }, stockQty: { type: 'integer' }, sku: { type: 'string' },
          weightKg: { type: 'number' }, requiresColdBag: { type: 'boolean' },
          images: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Up to 5' },
        },
      },
    },
  },
};
paths['/vendor/products'] = {
  get: { tags: TAG, summary: 'My products', ...bearer(), parameters: [...PAGE_QS, q('status', 'active | inactive')], responses: { 200: envelope(paginated(ref('Product'))), ...guarded } },
  post: { tags: TAG, summary: 'Add a product to my store', ...bearer(), requestBody: productForm, responses: { 201: envelope(ref('Product')), ...guarded } },
};
paths['/vendor/products/{id}'] = {
  patch: { tags: TAG, summary: 'Edit one of my products', ...bearer(), parameters: [idParam()], requestBody: productForm, responses: { 200: envelope(ref('Product')), ...guarded, 404: RESPONSES_404 } },
  delete: { tags: TAG, summary: 'Delete one of my products', ...bearer(), parameters: [idParam()], responses: { 200: envelope({ type: 'object', nullable: true }), ...guarded, 404: RESPONSES_404 } },
};
paths['/vendor/products/{id}/status'] = {
  patch: { tags: TAG, summary: 'Activate / deactivate a product', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ status: { type: 'string', enum: ['active', 'inactive'] } }, ['status']), responses: { 200: envelope(ref('Product')), ...guarded, 404: RESPONSES_404 } },
};

paths['/vendor/inventory'] = {
  get: { tags: TAG, summary: 'Stock levels of my products', ...bearer(), parameters: [...PAGE_QS, q('lowStock', 'true = only low stock'), q('threshold', 'Low-stock threshold (default 5)')], responses: { 200: envelope(paginated(ref('Product'))), ...guarded } },
};
paths['/vendor/inventory/export'] = {
  get: { tags: TAG, summary: 'Download my inventory as CSV', ...bearer(), responses: { 200: { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } }, ...guarded } },
};
paths['/vendor/inventory/import'] = {
  post: {
    tags: TAG, summary: 'Bulk stock update from a CSV (same columns as the export)', ...bearer(),
    requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } } } },
    responses: { 200: envelope({ type: 'object', properties: { updated: { type: 'integer' }, errors: { type: 'array', items: { type: 'object' } } } }), ...guarded },
  },
};

paths['/vendor/orders'] = {
  get: { tags: TAG, summary: 'Orders my store is the hub of or supplies items to', ...bearer(), parameters: [...PAGE_QS, q('status', 'Order status')], responses: { 200: envelope(paginated(ref('Order'))), ...guarded } },
};
paths['/vendor/orders/{id}'] = {
  get: { tags: TAG, summary: 'One order', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order')), ...guarded, 404: RESPONSES_404 } },
};
paths['/vendor/orders/{id}/tracking'] = {
  get: { tags: TAG, summary: 'Live rider position and ETA for one order', ...bearer(), parameters: [idParam()], responses: { 200: envelope({ type: 'object' }), ...guarded, 404: RESPONSES_404 } },
};
paths['/vendor/orders/{id}/cancel'] = {
  patch: { tags: TAG, summary: "Cancel an order of my store (a paid order is refunded to the customer's wallet)", ...bearer(), parameters: [idParam()], requestBody: jsonBody({ reason: { type: 'string' } }, ['reason']), responses: { 200: envelope(ref('Order')), 400: errorResponse('Order can no longer be cancelled'), ...guarded, 404: RESPONSES_404 } },
};
paths['/vendor/orders/{id}/mark-returned'] = {
  patch: { tags: TAG, summary: 'Mark a failed delivery as returned to my store', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ reason: { type: 'string' } }, ['reason']), responses: { 200: envelope(ref('Order')), ...guarded, 404: RESPONSES_404 } },
};

paths['/vendor/hub-displays'] = {
  get: { tags: TAG, summary: 'Hub Center screens paired with my store', ...bearer(), responses: { 200: envelope({ type: 'array', items: { type: 'object' } }), ...guarded } },
  post: { tags: TAG, summary: 'Pair a new screen — the pairing link is returned only here, once', ...bearer(), requestBody: jsonBody({ name: { type: 'string', example: 'Packing counter' } }, ['name']), responses: { 201: envelope({ type: 'object', properties: { display: { type: 'object' }, pairingUrl: { type: 'string' } } }), ...guarded } },
};
paths['/vendor/hub-displays/{id}'] = {
  delete: { tags: TAG, summary: 'Revoke a screen (disconnects it)', ...bearer(), parameters: [idParam()], responses: { 200: envelope({ type: 'object' }), ...guarded, 404: RESPONSES_404 } },
};

module.exports = paths;
