const schemas = require('./schemas');

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Grovio API',
    version: '1.0.0',
    description:
      'Multi-vendor grocery/quick-commerce backend — Admin, Vendor, Customer, Picker and Delivery APIs.\n\n' +
      '**Auth**: Admin/Vendor use email+password (`/auth/login`); Customer/Picker/Delivery use mobile+OTP ' +
      '(`/auth/send-otp` then `/auth/verify-otp`). Every protected endpoint needs `Authorization: Bearer <accessToken>` ' +
      '— click **Authorize** below and paste an `accessToken` obtained from a login/verify-otp response.\n\n' +
      'All successful responses share the envelope `{ success, message, data }`; failures are `{ success: false, message, errors }`.',
  },
  servers: [{ url: 'http://localhost:5000/api/v1', description: 'Local dev' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
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
    { name: 'Vendor - Business' },
    { name: 'Vendor - Stores' },
    { name: 'Vendor - Products' },
    { name: 'Vendor - Orders' },
    { name: 'Vendor - Reviews' },
    { name: 'Vendor - Offers' },
    { name: 'Vendor - Reports & Settlements' },
    { name: 'Customer - Home & Catalog' },
    { name: 'Customer - Cart' },
    { name: 'Customer - Addresses' },
    { name: 'Customer - Checkout & Orders' },
    { name: 'Customer - Wallet' },
    { name: 'Customer - Coupons' },
    { name: 'Customer - Support' },
    { name: 'Picker' },
    { name: 'Delivery' },
  ],
  paths: {
    ...require('./paths/core.paths'),
    ...require('./paths/admin.paths'),
    ...require('./paths/vendor.paths'),
    ...require('./paths/customer.paths'),
    ...require('./paths/picker.paths'),
    ...require('./paths/delivery.paths'),
  },
};

module.exports = spec;
