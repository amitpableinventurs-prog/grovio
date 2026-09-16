import { apiClient, unwrap } from './client';
import type { Banner } from '../types';

export function fetchBanners() {
  return unwrap<Banner[]>(apiClient.get('/admin/banners'));
}

export function createBanner(formData: FormData) {
  return unwrap<Banner>(apiClient.post('/admin/banners', formData));
}

export function updateBanner(id: string, formData: FormData) {
  return unwrap<Banner>(apiClient.patch(`/admin/banners/${id}`, formData));
}

export function deleteBanner(id: string) {
  return unwrap(apiClient.delete(`/admin/banners/${id}`));
}
