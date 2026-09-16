const {
  envelope, paginated, ref, errorResponse,
  RESPONSES_401, RESPONSES_404,
  jsonBody, idParam, q, PAGE_QS, bearer,
} = require('../helpers');

const paths = {};
const TAG_HOME = ['Customer - Home & Catalog'];
const TAG_CART = ['Customer - Cart'];
const TAG_ADDR = ['Customer - Addresses'];
const TAG_ORDERS = ['Customer - Checkout & Orders'];
const TAG_WALLET = ['Customer - Wallet'];
const TAG_COUPONS = ['Customer - Coupons'];
const TAG_SUPPORT = ['Customer - Support'];

paths['/customer/home'] = {
  get: { tags: TAG_HOME, summary: 'Landing-screen feed: banners + categories + featured products + offers', ...bearer(), responses: { 200: envelope({ type: 'object', properties: { banners: { type: 'array', items: ref('Banner') }, categories: { type: 'array', items: ref('Category') }, featuredProducts: { type: 'array', items: ref('Product') }, offers: { type: 'array', items: ref('Coupon') } } }), 401: RESPONSES_401 } },
};
paths['/customer/categories'] = {
  get: { tags: TAG_HOME, summary: 'Category tree', ...bearer(), responses: { 200: envelope({ type: 'array', items: ref('Category') }), 401: RESPONSES_401 } },
};
paths['/customer/stores'] = {
  get: {
    tags: TAG_HOME, summary: 'Browse stores, optionally sorted by distance', ...bearer(),
    parameters: [...PAGE_QS, q('search'), q('lat', 'Customer latitude', { type: 'number' }), q('lng', 'Customer longitude', { type: 'number' }), q('radiusKm', 'Max distance in km', { type: 'number' })],
    responses: { 200: envelope(paginated(ref('Store'))), 401: RESPONSES_401 },
  },
};
paths['/customer/stores/{id}'] = {
  get: { tags: TAG_HOME, summary: 'Store detail', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Store')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/customer/products'] = {
  get: { tags: TAG_HOME, summary: 'Browse/search products', ...bearer(), parameters: [...PAGE_QS, q('storeId'), q('categoryId'), q('search')], responses: { 200: envelope(paginated(ref('Product'))), 401: RESPONSES_401 } },
};
paths['/customer/products/{id}'] = {
  get: { tags: TAG_HOME, summary: 'Product detail', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Product')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

paths['/customer/cart'] = {
  get: { tags: TAG_CART, summary: 'Get my cart', ...bearer(), responses: { 200: envelope(ref('Cart')), 401: RESPONSES_401 } },
  delete: { tags: TAG_CART, summary: 'Clear my cart', ...bearer(), responses: { 200: envelope(ref('Cart'), 'Cart cleared'), 401: RESPONSES_401 } },
};
paths['/customer/cart/items'] = {
  post: { tags: TAG_CART, summary: 'Add an item to cart (switching stores clears the cart)', ...bearer(), requestBody: jsonBody({ productId: { type: 'string' }, variantId: { type: 'string' }, qty: { type: 'integer', default: 1 } }, ['productId']), responses: { 200: envelope(ref('Cart'), 'Added to cart'), 401: RESPONSES_401, 404: errorResponse('Product not found or unavailable') } },
};
paths['/customer/cart/items/{id}'] = {
  patch: { tags: TAG_CART, summary: 'Update an item\'s quantity (qty<=0 removes it)', ...bearer(), parameters: [idParam('id', 'Cart item subdocument ID')], requestBody: jsonBody({ qty: { type: 'integer' } }, ['qty']), responses: { 200: envelope(ref('Cart'), 'Cart updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
  delete: { tags: TAG_CART, summary: 'Remove an item from cart', ...bearer(), parameters: [idParam('id', 'Cart item subdocument ID')], responses: { 200: envelope(ref('Cart'), 'Item removed from cart'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/customer/cart/apply-coupon'] = {
  post: { tags: TAG_CART, summary: 'Validate and apply a coupon to the cart', ...bearer(), requestBody: jsonBody({ code: { type: 'string' } }, ['code']), responses: { 200: envelope(ref('Cart'), 'Coupon applied'), 400: errorResponse('Invalid/expired/ineligible coupon'), 401: RESPONSES_401 } },
};
paths['/customer/cart/coupon'] = {
  delete: { tags: TAG_CART, summary: 'Remove the applied coupon', ...bearer(), responses: { 200: envelope(ref('Cart'), 'Coupon removed'), 401: RESPONSES_401 } },
};

paths['/customer/addresses'] = {
  get: { tags: TAG_ADDR, summary: 'List my saved addresses', ...bearer(), responses: { 200: envelope({ type: 'array', items: ref('Address') }), 401: RESPONSES_401 } },
  post: { tags: TAG_ADDR, summary: 'Add an address', ...bearer(), requestBody: jsonBody({ label: { type: 'string' }, line1: { type: 'string' }, landmark: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, pincode: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, isDefault: { type: 'boolean' } }, ['line1']), responses: { 201: envelope(ref('Address'), 'Address added'), 401: RESPONSES_401 } },
};
paths['/customer/addresses/{id}'] = {
  put: { tags: TAG_ADDR, summary: 'Update an address', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ label: { type: 'string' }, line1: { type: 'string' }, landmark: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, pincode: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, isDefault: { type: 'boolean' } }), responses: { 200: envelope(ref('Address'), 'Address updated'), 401: RESPONSES_401, 404: RESPONSES_404 } },
  delete: { tags: TAG_ADDR, summary: 'Delete an address', ...bearer(), parameters: [idParam()], responses: { 200: envelope(null, 'Address deleted'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};

paths['/customer/checkout/summary'] = {
  post: { tags: TAG_ORDERS, summary: 'Server-side recalculation of totals before placing the order (no side effects)', ...bearer(), requestBody: jsonBody({ couponCode: { type: 'string', description: 'Optional override of the cart\'s applied coupon' } }), responses: { 200: envelope({ type: 'object', properties: { storeId: { type: 'string' }, itemTotal: { type: 'number' }, deliveryFee: { type: 'number' }, discount: { type: 'number' }, tax: { type: 'number' }, grandTotal: { type: 'number' }, couponCode: { type: 'string', nullable: true } } }), 400: errorResponse('Cart empty / store closed / coupon invalid'), 401: RESPONSES_401 } },
};
paths['/customer/orders'] = {
  post: { tags: TAG_ORDERS, summary: 'Place an order from the current cart', ...bearer(), requestBody: jsonBody({ addressId: { type: 'string' }, paymentMethod: { type: 'string', enum: ['COD', 'RAZORPAY', 'WALLET'], default: 'COD' } }, ['addressId']), responses: { 201: envelope(ref('Order'), 'Order placed successfully'), 400: errorResponse('Cart empty / item out of stock / store closed'), 401: RESPONSES_401 } },
  get: { tags: TAG_ORDERS, summary: 'My order history', ...bearer(), parameters: [...PAGE_QS, q('status')], responses: { 200: envelope(paginated(ref('Order'))), 401: RESPONSES_401 } },
};
paths['/customer/orders/{id}'] = {
  get: { tags: TAG_ORDERS, summary: 'Order detail', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('Order')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/customer/orders/{id}/tracking'] = {
  get: { tags: TAG_ORDERS, summary: 'Lightweight status-timeline for a tracking screen', ...bearer(), parameters: [idParam()], responses: { 200: envelope(ref('OrderTracking')), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/customer/orders/{id}/delivery-pin'] = {
  get: { tags: TAG_ORDERS, summary: 'Get the PIN to give the delivery partner (only once assigned/out for delivery)', ...bearer(), parameters: [idParam()], responses: { 200: envelope({ type: 'object', properties: { deliveryPin: { type: 'string', example: '4552' } } }), 400: errorResponse('No delivery PIN available yet'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/customer/orders/{id}/cancel'] = {
  post: { tags: TAG_ORDERS, summary: 'Cancel an order (refunds to wallet if already paid)', ...bearer(), parameters: [idParam()], requestBody: jsonBody({ reason: { type: 'string' } }), responses: { 200: envelope(ref('Order'), 'Order cancelled'), 400: errorResponse('Cannot cancel from current status'), 401: RESPONSES_401, 404: RESPONSES_404 } },
};
paths['/customer/orders/{orderId}/rating'] = {
  post: { tags: TAG_ORDERS, summary: 'Rate a delivered order (store + optional product + optional delivery partner)', ...bearer(), parameters: [idParam('orderId')], requestBody: jsonBody({ rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string' }, productId: { type: 'string' }, deliveryPartnerRating: { type: 'integer', minimum: 1, maximum: 5 } }, ['rating']), responses: { 201: envelope({ type: 'object' }, 'Review submitted'), 404: errorResponse('Delivered order not found'), 409: errorResponse('Already reviewed'), 401: RESPONSES_401 } },
};

paths['/customer/wallet'] = {
  get: { tags: TAG_WALLET, summary: 'Wallet balance', ...bearer(), responses: { 200: envelope(ref('Wallet')), 401: RESPONSES_401 } },
};
paths['/customer/wallet/transactions'] = {
  get: { tags: TAG_WALLET, summary: 'Wallet transaction history', ...bearer(), parameters: PAGE_QS, responses: { 200: envelope(paginated(ref('WalletTransaction'))), 401: RESPONSES_401 } },
};

paths['/customer/coupons'] = {
  get: { tags: TAG_COUPONS, summary: 'List available coupons (platform + that store\'s own offers)', ...bearer(), parameters: [q('storeId')], responses: { 200: envelope({ type: 'array', items: ref('Coupon') }), 401: RESPONSES_401 } },
};

paths['/customer/support/tickets'] = {
  post: { tags: TAG_SUPPORT, summary: 'Create a support ticket', ...bearer(), requestBody: jsonBody({ subject: { type: 'string' }, message: { type: 'string' } }, ['subject', 'message']), responses: { 201: envelope(ref('SupportTicket'), 'Support ticket created'), 401: RESPONSES_401 } },
};

module.exports = paths;
