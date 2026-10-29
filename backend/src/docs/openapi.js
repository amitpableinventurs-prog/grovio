const schemas = require('./schemas');

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Grovio API',
    version: '1.0.0',
    description:
      'Multi-store grocery/quick-commerce backend — Admin, Customer, Picker and Delivery APIs. ' +
      'Stores are admin-owned system entities; there is no vendor/store login.\n\n' +
      '**Auth**: Admin uses email+password (`/auth/login`); Customer/Picker/Delivery use mobile+OTP ' +
      '(`/auth/send-otp` then `/auth/verify-otp`) — Picker/Delivery accounts must already exist (created by Admin) ' +
      'before OTP login will work. Every protected endpoint needs `Authorization: Bearer <accessToken>` ' +
      '— click **Authorize** below and paste an `accessToken` obtained from a login/verify-otp response.\n\n' +
      'All successful responses share the envelope `{ success, message, data }`; failures are `{ success: false, message, errors }`.',
  },
  // Relative first: "Try it out" then calls whatever host the docs were opened from (localhost,
  // the LAN IP from a phone/another PC, or a tunnel URL) instead of the viewer's own localhost.
  servers: [
    { url: '/api/v1', description: 'This server (same address as these docs)' },
    { url: 'http://localhost:5000/api/v1', description: 'Local dev' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      // Hub Center screens — the key from the pairing link (see POST /admin/stores/{id}/hub-displays).
      hubDisplayKey: { type: 'apiKey', in: 'header', name: 'X-Hub-Display-Key' },
    },
    schemas,
  },
  tags: [
    { name: 'Auth' },
    { name: 'Common' },
    { name: 'Payments' },
    { name: 'Admin - Dashboard' },
    { name: 'Admin - Users' },
    { name: 'Admin - Stores' },
    { name: 'Admin - Catalog' },
    { name: 'Admin - Orders' },
    { name: 'Admin - Promotions' },
    { name: 'Admin - Settings' },
    { name: 'Admin - Reports' },
    { name: 'Admin - Support' },
    { name: 'Admin - Inventory' },
    { name: 'Admin - Payments' },
    { name: 'Admin - Settlements' },
    { name: 'Admin - RBAC' },
    { name: 'Admin - Delivery Programs' },
    { name: 'Customer - Home & Catalog' },
    { name: 'Customer - Cart' },
    { name: 'Customer - Addresses' },
    { name: 'Customer - Checkout & Orders' },
    { name: 'Customer - Wallet' },
    { name: 'Customer - Coupons' },
    { name: 'Customer - Support' },
    { name: 'Account deletion' },
    { name: 'Vendor' },
    { name: 'Picker' },
    { name: 'Delivery' },
    { name: 'Delivery - Gigs, Offers & Earnings' },
    { name: 'Hub Screen' },
    { name: 'IVR (Exotel webhooks)' },
    { name: 'VoIP (masked calls)' },
    { name: 'Notices (Updates tab)' },
    { name: 'Picker - Earnings' },
    { name: 'SOS' },
    { name: 'Admin - SOS' },
    { name: 'Error Logs' },
    { name: 'Admin - Error Logs' },
  ],
  paths: {
    ...require('./paths/core.paths'),
    ...require('./paths/admin.paths'),
    ...require('./paths/vendor.paths'),
    ...require('./paths/customer.paths'),
    ...require('./paths/picker.paths'),
    ...require('./paths/delivery.paths'),
    ...require('./paths/hubDisplay.paths'),
    ...require('./paths/features.paths'),
    ...require('./paths/programs.paths'),
    ...require('./paths/sos.paths'),
    ...require('./paths/errorLogs.paths'),
  },
};

module.exports = spec;
