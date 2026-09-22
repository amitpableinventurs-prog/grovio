import { apiClient, unwrap } from './client';
import type { Order, Paginated } from '../types';

export interface CheckoutStoreSummary {
  storeId: string;
  storeName: string;
  itemTotal: number;
  deliveryFee: number;
  discount: number;
  grandTotal: number;
}

export interface CheckoutSummary {
  stores: CheckoutStoreSummary[];
  itemTotal: number;
  deliveryFee: number;
  discount: number;
  tax: number;
  grandTotal: number;
  couponCode: string | null;
  walletBalance: number;
  walletSufficient: boolean;
}

export function checkoutSummary(couponCode?: string) {
  return unwrap<CheckoutSummary>(apiClient.post('/customer/checkout/summary', { couponCode }));
}

// A cart spanning multiple stores still becomes a single order, consolidated at a hub store — see
// backend/src/controllers/customer/orders.controller.js#placeOrder.
export function placeOrder(addressId: string, paymentMethod: 'COD' | 'RAZORPAY' | 'WALLET' = 'COD') {
  return unwrap<Order>(apiClient.post('/customer/orders', { addressId, paymentMethod }));
}

export function listOrders(status?: string) {
  return unwrap<Paginated<Order>>(apiClient.get('/customer/orders', { params: { status, limit: 50 } }));
}

export function getOrder(id: string) {
  return unwrap<Order>(apiClient.get(`/customer/orders/${id}`));
}

export function getTracking(id: string) {
  return unwrap(apiClient.get(`/customer/orders/${id}/tracking`));
}

export function cancelOrder(id: string, reason?: string) {
  return unwrap<Order>(apiClient.post(`/customer/orders/${id}/cancel`, { reason }));
}
