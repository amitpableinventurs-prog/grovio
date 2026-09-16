import { apiClient, unwrap } from './client';

export function fetchSettings() {
  return unwrap<Record<string, string>>(apiClient.get('/admin/settings'));
}

export function updateSettings(data: Record<string, string>) {
  return unwrap<Record<string, string>>(apiClient.put('/admin/settings', data));
}
