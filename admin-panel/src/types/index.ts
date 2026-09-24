export type Role = 'admin' | 'vendor' | 'customer' | 'picker' | 'delivery';

export interface PageMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface User {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  role: Role;
  permissions?: string[];
  profileImage?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  dateOfBirth?: string | null;
  isActive: boolean;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Vendor {
  _id: string;
  user: string | User;
  businessName: string;
  documents: string[];
  commissionPercent: number;
  status: 'pending' | 'approved' | 'rejected' | 'blocked';
  createdAt: string;
}

export interface Store {
  _id: string;
  vendor: string | Vendor;
  name: string;
  logo?: string | null;
  banner?: string | null;
  description?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  zoneId?: string | null;
  openTime?: string | null;
  closeTime?: string | null;
  isOpen: boolean;
  status: 'active' | 'inactive';
  createdAt: string;
}

// A Hub Center screen showing /hub-display — see backend models/hubDisplay.model.js.
export interface HubDisplay {
  _id: string;
  store: string;
  name: string;
  createdBy?: { _id: string; name: string } | string | null;
  lastSeenAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface PickerProfile {
  _id: string;
  user: string | User;
  store?: string | Store | null;
  status: 'pending' | 'approved' | 'blocked';
  isAvailable: boolean;
  onlineStatus?: 'online' | 'offline';
  employeeId?: string | null;
  address?: string | null;
  idProofType?: string | null;
  idProofNumber?: string | null;
  idProofDocument?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  joiningDate?: string | null;
  shift?: string | null;
  createdAt?: string;
}

// Where a picker is in app onboarding — computed by the backend (utils/pickerOnboarding.js), the
// same object the Picker app routes on.
export interface PickerOnboarding {
  status: 'pending' | 'approved' | 'blocked';
  profileComplete: boolean;
  kycComplete: boolean;
  nextStep: 'profile' | 'kyc' | 'pending_approval' | 'home' | 'blocked';
}

export interface DeliveryProfile {
  _id: string;
  user: string | User;
  vehicleType?: string | null;
  vehicleNumber?: string | null;
  licenseNumber?: string | null;
  status: 'pending' | 'approved' | 'blocked';
  isAvailable: boolean;
  currentLat?: number | null;
  currentLng?: number | null;
}

export interface UserWithProfile extends User {
  vendorProfile?: Vendor | null;
  pickerProfile?: PickerProfile | null;
  deliveryProfile?: DeliveryProfile | null;
  onboarding?: PickerOnboarding;
}

export interface Category {
  _id: string;
  name: string;
  image?: string | null;
  parent?: string | null;
  status: 'active' | 'inactive';
  children?: Category[];
}

export interface ProductVariant {
  _id: string;
  label: string;
  price: number;
  discountPrice?: number | null;
  stockQty: number;
  sku?: string | null;
  isAvailable: boolean;
}

export interface Product {
  _id: string;
  store: string | Store;
  category: string | Category;
  name: string;
  description?: string | null;
  images: string[];
  unit: string;
  price: number;
  discountPrice?: number | null;
  stockQty: number;
  sku?: string | null;
  variants: ProductVariant[];
  isAvailable: boolean;
  status: 'active' | 'inactive';
  qrToken?: string | null;
  createdAt: string;
}

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'rejected'
  | 'picking'
  | 'partially_picked'
  | 'packed'
  | 'assigned'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivery_failed'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export interface OrderItem {
  _id: string;
  product: string;
  variantId?: string | null;
  variantLabel?: string | null;
  nameSnapshot: string;
  price: number;
  qty: number;
  pickedQty?: number | null;
  assignedPicker?: string | User | null;
  pickedAt?: string | null;
  isAvailable: boolean;
  substituteProduct?: string | null;
  substituteNote?: string | null;
}

export interface PickTask {
  _id: string;
  picker: string | User;
  status: 'assigned' | 'picking' | 'completed';
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface StatusLog {
  _id: string;
  status: string;
  changedBy?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface ScannerLog {
  _id: string;
  order: string | { _id: string; orderNumber: string };
  qrType: 'handover';
  qrToken?: string | null;
  scannedBy: string | User;
  userType: 'picker' | 'delivery';
  deviceId?: string | null;
  location?: { lat: number | null; lng: number | null } | null;
  status: 'success' | 'failed';
  failureReason?: string | null;
  createdAt: string;
}

export interface Order {
  _id: string;
  orderNumber: string;
  customer: string | User;
  vendor: string | Vendor;
  store: string | Store;
  address: string;
  pickTasks: PickTask[];
  delivery?: string | User | null;
  items: OrderItem[];
  statusLogs: StatusLog[];
  itemTotal: number;
  deliveryFee: number;
  handlingCharge?: number;
  packingCharge?: number;
  surcharge?: number;
  surchargeLabel?: string | null;
  deliveryPartnerEarning?: number | null;
  discount: number;
  tax: number;
  grandTotal: number;
  couponCode?: string | null;
  paymentMethod: 'COD' | 'RAZORPAY' | 'WALLET';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  orderStatus: OrderStatus;
  cancelReason?: string | null;
  placedAt: string;
  deliveredAt?: string | null;
  settled: boolean;
  createdAt: string;
}

export interface Coupon {
  _id: string;
  code: string;
  vendor?: string | null;
  discountType: 'flat' | 'percent';
  discountValue: number;
  minOrderAmount: number;
  maxDiscount?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  usageLimit?: number | null;
  perUserLimit: number;
  isActive: boolean;
  createdAt: string;
}

export interface Banner {
  _id: string;
  title?: string | null;
  image: string;
  linkType: 'product' | 'category' | 'vendor' | 'url' | 'none';
  linkValue?: string | null;
  position: number;
  isActive: boolean;
}

export interface SupportTicket {
  _id: string;
  user: string | User;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  adminReply?: string | null;
  createdAt: string;
}

export interface Payment {
  _id: string;
  order: string | Order;
  user: string | User;
  amount: number;
  method: 'COD' | 'RAZORPAY' | 'WALLET';
  collectionMethod?: 'cash' | 'upi' | null;
  instrument?: 'card' | 'upi' | 'netbanking' | 'wallet' | 'emi' | null;
  gatewayOrderId?: string | null;
  gatewayPaymentId?: string | null;
  status: 'created' | 'paid' | 'failed' | 'refunded';
  failureReason?: string | null;
  createdAt: string;
}

export interface Refund {
  _id: string;
  order: string | Order;
  payment?: string | null;
  amount: number;
  reason: string;
  initiatedBy: string;
  status: 'processed' | 'failed';
  createdAt: string;
}

export interface Settlement {
  _id: string;
  payeeRole: 'vendor' | 'picker' | 'delivery';
  payeeUser: string | User;
  vendor?: string | Vendor | null;
  periodFrom: string;
  periodTo: string;
  orderCount: number;
  grossAmount: number;
  commissionAmount: number;
  payoutAmount: number;
  status: 'pending' | 'paid' | 'cancelled';
  paidAt?: string | null;
  createdAt: string;
}

export interface AdminActivityLog {
  _id: string;
  admin: string | User;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardStats {
  totalOrders: number;
  totalCustomers: number;
  totalVendors: number;
  pendingVendors: number;
  activeStores: number;
  activePickers: number;
  activeDeliveryPartners: number;
  totalProducts: number;
  deliveredOrders: number;
  cancelledOrders: number;
  gmv: number;
  averageOrderValue: number;
}

// Order charges configured on the Charges page — see backend/src/services/charges.service.js.
export type ChargeType = 'fixed' | 'percent';
export interface ChargeRule {
  enabled: boolean;
  type: ChargeType;
  value: number;
}
export interface ChargeConfig {
  delivery: ChargeRule & { freeAbove: number };
  handling: ChargeRule;
  packing: ChargeRule;
  surcharge: ChargeRule & { label: string };
}
