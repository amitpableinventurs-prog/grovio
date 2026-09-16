import { apiClient, unwrap } from './client';
import type { Order, Paginated } from '../types';
import type { ListParams } from './common';

export function fetchOrders(params: ListParams = {}) {
  return unwrap<Paginated<Order>>(apiClient.get('/admin/orders', { params }));
}

export function fetchOrder(id: string) {
  return unwrap<Order>(apiClient.get(`/admin/orders/${id}`));
}

export function assignPickerToOrder(orderId: string, pickerId: string) {
  return unwrap<Order>(apiClient.patch(`/admin/orders/${orderId}/assign-picker`, { pickerId }));
}

export function assignDeliveryToOrder(orderId: string, deliveryId: string) {
  return unwrap<Order>(apiClient.patch(`/admin/orders/${orderId}/assign-delivery`, { deliveryId }));
}

export function issueRefund(orderId: string, amount: number, reason: string) {
  return unwrap(apiClient.post(`/admin/orders/${orderId}/refund`, { amount, reason }));
}
