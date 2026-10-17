import { apiClient, unwrap } from './client';
import type { Order, Paginated } from '../types';
import type { ListParams } from './common';

// Orders my store is the hub of or supplies items to. Picker / delivery assignment and refunds are
// done by the admin.
export function fetchOrders(params: ListParams = {}) {
  return unwrap<Paginated<Order>>(apiClient.get('/vendor/orders', { params }));
}

export function fetchOrder(id: string) {
  return unwrap<Order>(apiClient.get(`/vendor/orders/${id}`));
}

export function cancelOrder(orderId: string, reason: string) {
  return unwrap<Order>(apiClient.patch(`/vendor/orders/${orderId}/cancel`, { reason }));
}

export function markOrderReturned(orderId: string, reason: string) {
  return unwrap<Order>(apiClient.patch(`/vendor/orders/${orderId}/mark-returned`, { reason }));
}
