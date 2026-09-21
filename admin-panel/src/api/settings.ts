import { apiClient, unwrap } from './client';

// Values for secret keys (see SECRET_KEYS in the backend's settings.controller.js) come back
// masked (e.g. "••••1234") or null if never set — never the real value.
export function fetchSettings() {
  return unwrap<Record<string, string | null>>(apiClient.get('/admin/settings'));
}

export function updateSettings(data: Record<string, string | undefined>) {
  return unwrap<Record<string, string>>(apiClient.put('/admin/settings', data));
}
