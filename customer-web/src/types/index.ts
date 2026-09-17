export interface User {
  _id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: 'customer';
  gender?: 'male' | 'female' | 'other' | null;
  profileImage?: string | null;
  isActive: boolean;
  isVerified: boolean;
}

export interface Category {
  _id: string;
  name: string;
  image?: string | null;
  parent: string | null;
  status: 'active' | 'inactive';
  children?: Category[];
}

export interface Store {
  _id: string;
  name: string;
  logo?: string | null;
  banner?: string | null;
  description?: string | null;
  address?: string | null;
  openTime?: string | null;
  closeTime?: string | null;
  isOpen: boolean;
  status: 'active' | 'inactive';
}

export interface ProductVariant {
  _id: string;
  label: string;
  price: number;
  discountPrice?: number | null;
  stockQty: number;
  isAvailable: boolean;
}

export interface Product {
  _id: string;
  store: Store | string;
  category: Category | string;
  name: string;
  description?: string | null;
  images: string[];
  unit: string;
  price: number;
  discountPrice?: number | null;
  stockQty: number;
  variants: ProductVariant[];
  isAvailable: boolean;
  status: 'active' | 'inactive';
}

export interface CartItem {
  _id: string;
  product: Product;
  variantId: string | null;
  qty: number;
  priceSnapshot: number;
}

export interface Cart {
  _id: string;
  user: string;
  store: Store | string | null;
  items: CartItem[];
  couponCode: string | null;
  subtotal: number;
}

export interface Address {
  _id: string;
  label: string;
  line1: string;
  landmark?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  lat?: number | null;
  lng?: number | null;
  isDefault: boolean;
}

export interface OrderItem {
  product: string;
  variantId: string | null;
  variantLabel: string | null;
  nameSnapshot: string;
  price: number;
  qty: number;
}

export interface StatusLog {
  status: string;
  note?: string | null;
  createdAt: string;
}

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'rejected'
  | 'picking'
  | 'packed'
  | 'assigned'
  | 'out_for_delivery'
  | 'delivery_failed'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export interface Order {
  _id: string;
  orderNumber: string;
  store: Store | string;
  address: Address | string;
  items: OrderItem[];
  statusLogs: StatusLog[];
  itemTotal: number;
  deliveryFee: number;
  discount: number;
  tax: number;
  grandTotal: number;
  couponCode: string | null;
  paymentMethod: 'COD' | 'RAZORPAY' | 'WALLET';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  orderStatus: OrderStatus;
  cancelReason?: string | null;
  placedAt: string;
  deliveredAt?: string | null;
  createdAt: string;
}

export interface Banner {
  _id: string;
  title?: string | null;
  image: string;
  linkType: 'product' | 'category' | 'vendor' | 'url' | 'none';
  linkValue?: string | null;
  position: number;
}

export interface Coupon {
  _id: string;
  code: string;
  discountType: 'flat' | 'percent';
  discountValue: number;
  minOrderAmount: number;
  maxDiscount?: number | null;
}

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
