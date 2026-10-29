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

export function deleteStore(id: string) {
  return unwrap(apiClient.delete(`/admin/stores/${id}`));
}

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

export function searchPlaces(q: string) {
  return unwrap<Place[]>(apiClient.get('/admin/places', { params: { q } }));
}
