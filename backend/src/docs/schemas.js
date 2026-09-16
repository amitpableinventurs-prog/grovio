const id = { type: 'string', example: '66f1a2b3c4d5e6f789012345' };
const dateTime = { type: 'string', format: 'date-time', example: '2026-09-15T10:05:56.144Z' };
const money = { type: 'number', example: 120.0 };

const PageMeta = {
  type: 'object',
  properties: {
    page: { type: 'integer', example: 1 },
    limit: { type: 'integer', example: 20 },
    totalItems: { type: 'integer', example: 42 },
    totalPages: { type: 'integer', example: 3 },
  },
};

const User = {
  type: 'object',
  properties: {
    _id: id,
    name: { type: 'string', example: 'Test Customer' },
    email: { type: 'string', nullable: true, example: 'admin@grovio.com' },
    phone: { type: 'string', nullable: true, example: '8880002222' },
    role: { type: 'string', enum: ['admin', 'vendor', 'customer', 'picker', 'delivery'] },
    gender: { type: 'string', enum: ['male', 'female', 'other'], nullable: true },
    permissions: { type: 'array', items: { type: 'string' }, example: [] },
    profileImage: { type: 'string', nullable: true },
    fcmToken: { type: 'string', nullable: true },
    isActive: { type: 'boolean', example: true },
    isVerified: { type: 'boolean', example: true },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
};

const AuthTokens = {
  type: 'object',
  properties: {
    accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
    refreshToken: { type: 'string', example: '27826dfd4f45132e17e1b532787d3b6c6e1b0c568c4d604674a6bae32d5cf6d' },
    user: User,
  },
};

const Vendor = {
  type: 'object',
  properties: {
    _id: id,
    user: id,
    businessName: { type: 'string', example: 'Raj Kirana' },
    documents: { type: 'array', items: { type: 'string' } },
    commissionPercent: { type: 'number', example: 10 },
    status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'blocked'] },
    createdAt: dateTime,
  },
};

const Store = {
  type: 'object',
  properties: {
    _id: id,
    vendor: id,
    name: { type: 'string', example: 'Raj Kirana - MG Road' },
    logo: { type: 'string', nullable: true },
    banner: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    address: { type: 'string', example: 'MG Road' },
    lat: { type: 'number', nullable: true, example: 28.6 },
    lng: { type: 'number', nullable: true, example: 77.2 },
    zoneId: { type: 'string', nullable: true },
    openTime: { type: 'string', nullable: true, example: '09:00' },
    closeTime: { type: 'string', nullable: true, example: '21:00' },
    isOpen: { type: 'boolean', example: true },
    status: { type: 'string', enum: ['active', 'inactive'] },
    createdAt: dateTime,
  },
};

const PickerProfile = {
  type: 'object',
  properties: {
    _id: id,
    user: id,
    store: { ...id, nullable: true },
    status: { type: 'string', enum: ['pending', 'approved', 'blocked'] },
    isAvailable: { type: 'boolean' },
  },
};

const DeliveryProfile = {
  type: 'object',
  properties: {
    _id: id,
    user: id,
    vehicleType: { type: 'string', nullable: true },
    vehicleNumber: { type: 'string', nullable: true },
    licenseNumber: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['pending', 'approved', 'blocked'] },
    isAvailable: { type: 'boolean' },
    currentLat: { type: 'number', nullable: true },
    currentLng: { type: 'number', nullable: true },
  },
};

const UserWithProfile = {
  allOf: [
    User,
    {
      type: 'object',
      properties: {
        vendorProfile: { ...Vendor, nullable: true },
        pickerProfile: { ...PickerProfile, nullable: true },
        deliveryProfile: { ...DeliveryProfile, nullable: true },
      },
    },
  ],
};

const Category = {
  type: 'object',
  properties: {
    _id: id,
    name: { type: 'string', example: 'Fruits & Vegetables' },
    image: { type: 'string', nullable: true },
    parent: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['active', 'inactive'] },
    children: { type: 'array', items: { type: 'object' } },
  },
};

const ProductVariant = {
  type: 'object',
  properties: {
    _id: id,
    label: { type: 'string', example: '1kg pack' },
    price: money,
    discountPrice: { type: 'number', nullable: true },
    stockQty: { type: 'integer', example: 30 },
    sku: { type: 'string', nullable: true },
    isAvailable: { type: 'boolean' },
  },
};

const Product = {
  type: 'object',
  properties: {
    _id: id,
    store: id,
    category: id,
    name: { type: 'string', example: 'Fresh Apples' },
    description: { type: 'string', nullable: true },
    images: { type: 'array', items: { type: 'string' } },
    unit: { type: 'string', example: 'kg' },
    price: money,
    discountPrice: { type: 'number', nullable: true },
    stockQty: { type: 'integer', example: 50 },
    sku: { type: 'string', nullable: true },
    variants: { type: 'array', items: ProductVariant },
    isAvailable: { type: 'boolean' },
    status: { type: 'string', enum: ['active', 'inactive'] },
    createdAt: dateTime,
  },
};

const Address = {
  type: 'object',
  properties: {
    _id: id,
    user: id,
    label: { type: 'string', example: 'Home' },
    line1: { type: 'string', example: '123 Test St' },
    landmark: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true, example: 'Delhi' },
    state: { type: 'string', nullable: true },
    pincode: { type: 'string', nullable: true, example: '110001' },
    lat: { type: 'number', nullable: true },
    lng: { type: 'number', nullable: true },
    isDefault: { type: 'boolean' },
  },
};

const CartItem = {
  type: 'object',
  properties: {
    _id: id,
    product: id,
    variantId: { type: 'string', nullable: true },
    qty: { type: 'integer', example: 2 },
    priceSnapshot: money,
  },
};

const Cart = {
  type: 'object',
  properties: {
    _id: id,
    user: id,
    store: { ...id, nullable: true },
    items: { type: 'array', items: CartItem },
    couponCode: { type: 'string', nullable: true },
    subtotal: { type: 'number', example: 240 },
  },
};

const OrderItem = {
  type: 'object',
  properties: {
    _id: id,
    product: id,
    variantId: { type: 'string', nullable: true },
    variantLabel: { type: 'string', nullable: true },
    nameSnapshot: { type: 'string', example: 'Fresh Apples' },
    price: money,
    qty: { type: 'integer', example: 2 },
    pickedQty: { type: 'integer', nullable: true },
    isAvailable: { type: 'boolean' },
    substituteProduct: { type: 'string', nullable: true },
    substituteNote: { type: 'string', nullable: true },
  },
};

const StatusLog = {
  type: 'object',
  properties: {
    status: { type: 'string', example: 'accepted' },
    changedBy: { type: 'string', nullable: true },
    note: { type: 'string', nullable: true },
    createdAt: dateTime,
  },
};

const Order = {
  type: 'object',
  properties: {
    _id: id,
    orderNumber: { type: 'string', example: 'GRV-MU2IAXWQ-5201' },
    customer: id,
    vendor: id,
    store: id,
    address: id,
    picker: { type: 'string', nullable: true },
    delivery: { type: 'string', nullable: true },
    deliveryAcceptedAt: { ...dateTime, nullable: true },
    pickerHandoverAt: { ...dateTime, nullable: true },
    arrivedAtPickupAt: { ...dateTime, nullable: true },
    arrivedAtDropAt: { ...dateTime, nullable: true },
    failureReason: { type: 'string', nullable: true },
    items: { type: 'array', items: OrderItem },
    statusLogs: { type: 'array', items: StatusLog },
    itemTotal: money,
    deliveryFee: { type: 'number', example: 25 },
    discount: { type: 'number', example: 0 },
    tax: { type: 'number', example: 0 },
    grandTotal: money,
    couponCode: { type: 'string', nullable: true },
    paymentMethod: { type: 'string', enum: ['COD', 'RAZORPAY', 'WALLET'] },
    paymentStatus: { type: 'string', enum: ['pending', 'paid', 'failed', 'refunded'] },
    orderStatus: {
      type: 'string',
      enum: ['placed', 'accepted', 'rejected', 'picking', 'packed', 'assigned', 'out_for_delivery', 'delivery_failed', 'delivered', 'cancelled', 'returned'],
    },
    cancelReason: { type: 'string', nullable: true },
    placedAt: dateTime,
    deliveredAt: { ...dateTime, nullable: true },
    settled: { type: 'boolean' },
    createdAt: dateTime,
  },
};

const OrderTracking = {
  type: 'object',
  properties: {
    orderNumber: { type: 'string' },
    orderStatus: { type: 'string' },
    statusLogs: { type: 'array', items: StatusLog },
    deliveredAt: { ...dateTime, nullable: true },
    deliveryPartner: { type: 'object', nullable: true },
  },
};

const Coupon = {
  type: 'object',
  properties: {
    _id: id,
    code: { type: 'string', example: 'WELCOME50' },
    vendor: { type: 'string', nullable: true },
    discountType: { type: 'string', enum: ['flat', 'percent'] },
    discountValue: { type: 'number', example: 50 },
    minOrderAmount: { type: 'number', example: 100 },
    maxDiscount: { type: 'number', nullable: true },
    validFrom: { ...dateTime, nullable: true },
    validTo: { ...dateTime, nullable: true },
    usageLimit: { type: 'integer', nullable: true },
    perUserLimit: { type: 'integer', example: 5 },
    isActive: { type: 'boolean' },
  },
};

const Banner = {
  type: 'object',
  properties: {
    _id: id,
    title: { type: 'string', nullable: true },
    image: { type: 'string', example: '/uploads/1234-banner.jpg' },
    linkType: { type: 'string', enum: ['product', 'category', 'vendor', 'url', 'none'] },
    linkValue: { type: 'string', nullable: true },
    position: { type: 'integer', example: 0 },
    isActive: { type: 'boolean' },
  },
};

const SupportTicket = {
  type: 'object',
  properties: {
    _id: id,
    user: id,
    subject: { type: 'string' },
    message: { type: 'string' },
    status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
    adminReply: { type: 'string', nullable: true },
    createdAt: dateTime,
  },
};

const Payment = {
  type: 'object',
  properties: {
    _id: id,
    order: id,
    user: id,
    amount: money,
    method: { type: 'string', enum: ['COD', 'RAZORPAY', 'WALLET'] },
    gatewayOrderId: { type: 'string', nullable: true },
    gatewayPaymentId: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['created', 'paid', 'failed', 'refunded'] },
    createdAt: dateTime,
  },
};

const Refund = {
  type: 'object',
  properties: {
    _id: id,
    order: id,
    payment: { type: 'string', nullable: true },
    amount: money,
    reason: { type: 'string' },
    initiatedBy: id,
    status: { type: 'string', enum: ['processed', 'failed'] },
    createdAt: dateTime,
  },
};

const Settlement = {
  type: 'object',
  properties: {
    _id: id,
    payeeRole: { type: 'string', enum: ['vendor', 'picker', 'delivery'] },
    payeeUser: id,
    vendor: { type: 'string', nullable: true },
    periodFrom: dateTime,
    periodTo: dateTime,
    orderCount: { type: 'integer' },
    grossAmount: money,
    commissionAmount: { type: 'number' },
    payoutAmount: { type: 'number' },
    status: { type: 'string', enum: ['pending', 'paid', 'cancelled'] },
    paidAt: { ...dateTime, nullable: true },
  },
};

const AdminActivityLog = {
  type: 'object',
  properties: {
    _id: id,
    admin: id,
    action: { type: 'string', example: 'vendor.status_update' },
    entityType: { type: 'string', nullable: true },
    entityId: { type: 'string', nullable: true },
    metadata: { type: 'object' },
    createdAt: dateTime,
  },
};

const Notification = {
  type: 'object',
  properties: {
    _id: id,
    user: id,
    title: { type: 'string' },
    body: { type: 'string' },
    type: { type: 'string' },
    data: { type: 'object' },
    isRead: { type: 'boolean' },
    createdAt: dateTime,
  },
};

const Wallet = {
  type: 'object',
  properties: { balance: { type: 'number', example: 216 } },
};

const WalletTransaction = {
  type: 'object',
  properties: {
    _id: id,
    user: id,
    type: { type: 'string', enum: ['credit', 'debit'] },
    amount: money,
    reason: { type: 'string' },
    refOrderId: { type: 'string', nullable: true },
    balanceAfter: { type: 'number' },
    createdAt: dateTime,
  },
};

const DashboardStats = {
  type: 'object',
  properties: {
    totalOrders: { type: 'integer' },
    totalCustomers: { type: 'integer' },
    totalVendors: { type: 'integer' },
    pendingVendors: { type: 'integer' },
    activeStores: { type: 'integer' },
    activePickers: { type: 'integer' },
    activeDeliveryPartners: { type: 'integer' },
    totalProducts: { type: 'integer' },
    deliveredOrders: { type: 'integer' },
    cancelledOrders: { type: 'integer' },
    gmv: { type: 'number' },
    averageOrderValue: { type: 'number' },
  },
};

module.exports = {
  PageMeta,
  User,
  AuthTokens,
  Vendor,
  Store,
  PickerProfile,
  DeliveryProfile,
  UserWithProfile,
  Category,
  ProductVariant,
  Product,
  Address,
  CartItem,
  Cart,
  OrderItem,
  StatusLog,
  Order,
  OrderTracking,
  Coupon,
  Banner,
  SupportTicket,
  Payment,
  Refund,
  Settlement,
  AdminActivityLog,
  Notification,
  Wallet,
  WalletTransaction,
  DashboardStats,
};
