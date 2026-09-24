import { apiClient, unwrap } from './client';
import type { HubDisplay } from '../types';

export function fetchHubDisplays(storeId: string) {
  return unwrap<HubDisplay[]>(apiClient.get(`/admin/stores/${storeId}/hub-displays`));
}

// The pairing link carries the screen's device key and is only returned here, once.
export function createHubDisplay(storeId: string, name: string) {
  return unwrap<{ display: HubDisplay; pairingUrl: string }>(apiClient.post(`/admin/stores/${storeId}/hub-displays`, { name }));
}

export function revokeHubDisplay(id: string) {
  return unwrap<HubDisplay>(apiClient.delete(`/admin/hub-displays/${id}`));
}
