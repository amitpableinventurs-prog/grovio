import { apiClient, unwrap } from './client';
import type { ChargeConfig } from '../types';

export function fetchCharges() {
  return unwrap<ChargeConfig>(apiClient.get('/admin/charges'));
}

export function saveCharges(config: ChargeConfig) {
  return unwrap<ChargeConfig>(apiClient.put('/admin/charges', config));
}
