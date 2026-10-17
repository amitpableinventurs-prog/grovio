import { apiClient, unwrap } from './client';
import type { Store } from '../types';

// My store — read-only for the vendor; details and approval are set by the admin.
export function fetchMyStore() {
  return unwrap<Store>(apiClient.get('/vendor/store'));
}
