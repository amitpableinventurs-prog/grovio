import { apiClient, unwrap } from './client';
import type { Order, OrderTracking, Paginated, PaymentMethod } from '../types';

export interface CheckoutStoreSummary {
  storeId: string;
  storeName: string;
  itemTotal: number;
  discount: number;
}

// Charges apply once per order (not per store) — see backend services/charges.service.js.
export interface CheckoutSummary {
  stores: CheckoutStoreSummary[];
  itemTotal: number;
  deliveryFee: number;
  freeDeliveryAbove: number | null;
  freeDeliveryApplied: boolean;
  handlingCharge: number;
  packingCharge: number;
  surcharge: number;
  surchargeLabel: string | null;
  discount: number;
  tax: number;
  grandTotal: number;
  couponCode: string | null;
  walletBalance: number;
  walletSufficient: boolean;
  // Only when an addressId was sent: can every store in the cart deliver there?
  serviceArea: {
    serviceable: boolean;
    outside: { storeId: string; storeName: string; distanceKm: number; radiusKm: number }[];
    unverified: boolean;
  } | null;
  // Payment methods switched on in the admin panel, in display order.
  paymentOptions: { method: PaymentMethod; label: string; description: string }[];
}

export function checkoutSummary(couponCode?: string, addressId?: string | null) {
  return unwrap<CheckoutSummary>(apiClient.post('/customer/checkout/summary', { couponCode, addressId: addressId || undefined }));
}

// A cart spanning multiple stores still becomes a single order, consolidated at a hub store — see
// backend/src/controllers/customer/orders.controller.js#placeOrder.
export function placeOrder(addressId: string, paymentMethod: PaymentMethod = 'COD') {
  return unwrap<Order>(apiClient.post('/customer/orders', { addressId, paymentMethod }));
}

export function listOrders(status?: string) {
  return unwrap<Paginated<Order>>(apiClient.get('/customer/orders', { params: { status, limit: 50 } }));
}

export function getOrder(id: string) {
  return unwrap<Order>(apiClient.get(`/customer/orders/${id}`));
}

export function getTracking(id: string) {
  return unwrap<OrderTracking>(apiClient.get(`/customer/orders/${id}/tracking`));
}

export function cancelOrder(id: string, reason?: string) {
  return unwrap<Order>(apiClient.post(`/customer/orders/${id}/cancel`, { reason }));
}
