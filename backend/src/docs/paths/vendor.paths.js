const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_403, RESPONSES_404,
  jsonBody, formBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

const paths = {};
const TAG_BIZ = ['Vendor - Business'];
const TAG_STORES = ['Vendor - Stores'];
const TAG_PRODUCTS = ['Vendor - Products'];
const TAG_ORDERS = ['Vendor - Orders'];
const TAG_REVIEWS = ['Vendor - Reviews'];
const TAG_OFFERS = ['Vendor - Offers'];
const TAG_REPORTS = ['Vendor - Reports & Settlements'];

paths['/vendor/dashboard'] = {
  get: { tags: TAG_BIZ, summary: 'KPIs across all of this vendor\'s stores', ...bearer(), responses: { 200: envelope({ type: 'object', properties: { totalStores: { type: 'integer' }, totalProducts: { type: 'integer' }, pendingOrders: { type: 'integer' }, activeOrders: { type: 'integer' }, deliveredOrders: { type: 'integer' }, totalRevenue: { type: 'number' } } }), 401: RESPONSES_401, 403: RESPONSES_403 } },
};
paths['/vendor/business'] = {
  get: { tags: TAG_BIZ, summary: 'Get business profile', ...bearer(), responses: { 200: envelope(ref('Vendor')), 401: RESPONSES_401, 404: RESPONSES_404 } },
  put: { tags: TAG_BIZ, summary: 'Update business profile / upload documents', ...bearer(), requestBody: formBody({ businessName: { type: 'string' }, documents: { type: 'array', items: { type: 'string', format: 'binary' } } }), responses: { 200: envelope(ref('Vendor'), 'Business profile updated'), 401: RESPONSES_401 } },
};
paths['/vendor/earnings'] = {
  get: { tags: TAG_BIZ, summary: 'Wallet balance + transaction history', ...bearer(), responses: { 200: envelope({ type: 'object', properties: { balance: { type: 'number' }, transactions: { type: 'array', items: ref('WalletTransaction') } } }), 401: RESPONSES_401 } },
};

paths['/vendor/stores'] = {
  post: { tags: TAG_STORES, summary: 'Create a new store', ...bearer(), requestBody: jsonBody({ name: { type: 'string' }, description: { type: 'string' }, address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, zoneId: { type: 'string' }, openTime: { type: 'string' }, closeTime: { type: 'string' } }, ['name']), responses: { 201: envelope(ref('Store'), 'Store created'), 401: RESPONSES_401 } },
  get: { tags: TAG_STORES, summary: 'List my stores', ...bearer(), responses: { 200: envelope({ type: 'array', items: ref('Store') }), 401: RESPONSES_401 } },
};
paths['/vendor/stores/{id}'] = {
  get: { tags: TAG_STORES, summary: 'Get one of my stores', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Store')), 401: RESPONSES_401, 404: RESPONSES_404 } },
  put: { tags: TAG_STORES, summary: 'Update a store (incl. logo/banner upload)', ...bearer(), parameters: [idParam()], requestBody: formBody({ name: { type: 'string' }, description: { type: 'string' }, address: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, zoneId: { type: 'string' }, openTime: { type: 'string' }, closeTime: { type: 'string' }, logo: { type: 'string', format: 'binary' }, banner: { type: 'string', format: 'binary' } }), responses: { 200: envelope(ref('Store'), 'Store updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/vendor/stores/{id}/status'] = {
  patch: { tags: TAG_STORES, summary: 'Open/close a store', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ isOpen: { type: 'boolean' } }, ['isOpen']), responses: { 200: envelope(ref('Store')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

const productFields = { storeId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, categoryId: { type: 'string' }, unit: { type: 'string' }, price: { type: 'number' }, discountPrice: { type: 'number' }, stockQty: { type: 'integer' }, sku: { type: 'string' }, images: { type: 'array', items: { type: 'string', format: 'binary' } } };
paths['/vendor/products'] = {
  post: { tags: TAG_PRODUCTS, summary: 'Create a product under one of my stores', ...bearer(), requestBody: formBody(productFields, ['storeId', 'name', 'categoryId', 'unit', 'price']), responses: { 201: envelope(ref('Product'), 'Product created'), 401: RESPONSES_401, 403: errorResponse('You do not own this store') } },
  get: { tags: TAG_PRODUCTS, summary: 'List my products (storeId optional — defaults to all my stores)', ...bearer(), parameters: [...PAGE_QS, q('storeId'), q('status'), q('search')], responses: { 200: envelope(paginated(ref('Product'))), 401: RESPONSES_401 } },
};
paths['/vendor/products/{id}'] = {
  patch: { tags: TAG_PRODUCTS, summary: 'Update a product', ...bearer(), parameters: [idParam()], requestBody: formBody(productFields), responses: { 200: envelope(ref('Product'), 'Product updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
  delete: { tags: TAG_PRODUCTS, summary: 'Delete a product', ...bearer(), parameters: [idParam()], responses: { 200: envelope(null, 'Product deleted'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/vendor/products/{id}/stock'] = {
  patch: { tags: TAG_PRODUCTS, summary: 'Update stock quantity / availability', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ stockQty: { type: 'integer' }, isAvailable: { type: 'boolean' } }), responses: { 200: envelope(ref('Product'), 'Stock updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/vendor/products/{id}/price'] = {
  patch: { tags: TAG_PRODUCTS, summary: 'Update price / discount price', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ price: { type: 'number' }, discountPrice: { type: 'number' } }), responses: { 200: envelope(ref('Product'), 'Price updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/vendor/products/{id}/variants'] = {
  post: { tags: TAG_PRODUCTS, summary: 'Add a variant (e.g. "1kg pack")', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ label: { type: 'string' }, price: { type: 'number' }, discountPrice: { type: 'number' }, stockQty: { type: 'integer' }, sku: { type: 'string' } }, ['label', 'price']), responses: { 201: envelope(ref('Product'), 'Variant added'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/vendor/products/{id}/variants/{variantId}'] = {
  patch: { tags: TAG_PRODUCTS, summary: 'Update a variant', ...bearer(), parameters: [idParam(), idParam('variantId', 'Variant subdocument ID')], requestBody: jsonBody({ label: { type: 'string' }, price: { type: 'number' }, discountPrice: { type: 'number' }, stockQty: { type: 'integer' }, sku: { type: 'string' }, isAvailable: { type: 'boolean' } }), responses: { 200: envelope(ref('Product'), 'Variant updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
  delete: { tags: TAG_PRODUCTS, summary: 'Remove a variant', ...bearer(), parameters: [idParam(), idParam('variantId', 'Variant subdocument ID')], responses: { 200: envelope(ref('Product'), 'Variant removed'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

paths['/vendor/orders'] = {
  get: { tags: TAG_ORDERS, summary: 'List incoming/current/completed orders (storeId optional)', ...bearer(), parameters: [...PAGE_QS, q('storeId'), q('status')], responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
};
paths['/vendor/orders/{id}'] = {
  get: { tags: TAG_ORDERS, summary: 'Get order detail', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/vendor/orders/{id}/accept'] = {
  patch: { tags: TAG_ORDERS, summary: 'Accept an order (auto-assigns a picker if one is available)', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order'), 'Order accepted'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/vendor/orders/{id}/reject'] = {
  patch: { tags: TAG_ORDERS, summary: 'Reject an order with a reason', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ reason: { type: 'string' } }), responses: { 200: envelope(ref('Order'), 'Order rejected'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

paths['/vendor/reviews'] = {
  get: { tags: TAG_REVIEWS, summary: 'List reviews across all my stores', ...bearer(), parameters: PAGE_QS, responses: { 200: envelope(paginated({ type: 'object' })), 401: RESPONSES_401 } },
};

const offerBody = { code: { type: 'string' }, discountType: { type: 'string', enum: ['flat', 'percent'] }, discountValue: { type: 'number' }, minOrderAmount: { type: 'number' }, maxDiscount: { type: 'number' }, validFrom: { type: 'string', format: 'date-time' }, validTo: { type: 'string', format: 'date-time' }, usageLimit: { type: 'integer' }, perUserLimit: { type: 'integer' }, isActive: { type: 'boolean' } };
paths['/vendor/offers'] = {
  post: { tags: TAG_OFFERS, summary: 'Create a vendor-specific coupon (applies across all my stores)', ...bearer(), requestBody: jsonBody(offerBody, ['code', 'discountType', 'discountValue']), responses: { 201: envelope(ref('Coupon'), 'Offer created'), 401: RESPONSES_401 } },
  get: { tags: TAG_OFFERS, summary: 'List my offers', ...bearer(), responses: { 200: envelope({ type: 'array', items: ref('Coupon') }), 401: RESPONSES_401 } },
};
paths['/vendor/offers/{id}'] = {
  patch: { tags: TAG_OFFERS, summary: 'Update an offer', ...bearer(), parameters: [idParam()], requestBody: jsonBody(offerBody), responses: { 200: envelope(ref('Coupon'), 'Offer updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
  delete: { tags: TAG_OFFERS, summary: 'Delete an offer', ...bearer(), parameters: [idParam()], responses: { 200: envelope(null, 'Offer deleted'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

paths['/vendor/reports/sales'] = {
  get: { tags: TAG_REPORTS, summary: 'Sales totals + top products', ...bearer(), parameters: [q('from'), q('to'), q('storeId')], responses: { 200: envelope({ type: 'object', properties: { totalOrders: { type: 'integer' }, totalRevenue: { type: 'number' }, totalItemSales: { type: 'number' }, topProducts: { type: 'array', items: { type: 'object' } } } }), 401: RESPONSES_401 } },
};
paths['/vendor/settlements'] = {
  get: { tags: TAG_REPORTS, summary: 'Read-only payout/settlement history', ...bearer(), parameters: [...PAGE_QS, q('status')], responses: { 200: envelope(paginated(ref('Settlement'))), 401: RESPONSES_401 } },
};

module.exports = paths;
