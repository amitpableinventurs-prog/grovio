import { apiClient, unwrap } from './client';
import type { Store, HubPickupMode, HubPickupState } from '../types';

// My store — read-only for the vendor; details and approval are set by the admin.
export function fetchMyStore() {
  return unwrap<Store>(apiClient.get('/vendor/store'));
}

// How packed orders at my store get a rider — hub screen QR or auto-assign. null = Grovio default.
export function fetchHubPickup() {
  return unwrap<HubPickupState>(apiClient.get('/vendor/store/hub-pickup'));
}

export function updateHubPickup(mode: HubPickupMode | null) {
  return unwrap<HubPickupState>(apiClient.patch('/vendor/store/hub-pickup', { mode }));
}
