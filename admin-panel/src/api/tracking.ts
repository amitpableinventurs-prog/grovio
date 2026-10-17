import { apiClient, unwrap } from './client';
import type { LiveMapData, OrderTracking } from '../types';

export function fetchLiveRiders() {
  return unwrap<LiveMapData>(apiClient.get('/admin/tracking/riders'));
}

export function fetchOrderTracking(orderId: string) {
  return unwrap<OrderTracking>(apiClient.get(`/admin/orders/${orderId}/tracking`));
}
