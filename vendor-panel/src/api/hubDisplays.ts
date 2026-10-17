import { apiClient, unwrap } from './client';
import type { HubDisplay } from '../types';

// Hub Center screens at my store.
export function fetchHubDisplays() {
  return unwrap<HubDisplay[]>(apiClient.get('/vendor/hub-displays'));
}

// The pairing link carries the screen's device key and is only returned here, once.
export function createHubDisplay(name: string) {
  return unwrap<{ display: HubDisplay; pairingUrl: string }>(apiClient.post('/vendor/hub-displays', { name }));
}

export function revokeHubDisplay(id: string) {
  return unwrap<HubDisplay>(apiClient.delete(`/vendor/hub-displays/${id}`));
}
