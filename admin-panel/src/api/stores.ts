import { apiClient, unwrap } from './client';
import type { Paginated, Store } from '../types';
import type { ListParams } from './common';

export function fetchStores(params: ListParams = {}) {
  return unwrap<Paginated<Store>>(apiClient.get('/admin/stores', { params }));
}

export function fetchStore(id: string) {
  return unwrap<Store>(apiClient.get(`/admin/stores/${id}`));
}

export function updateStore(id: string, data: Partial<Store>) {
  return unwrap<Store>(apiClient.patch(`/admin/stores/${id}`, data));
}
