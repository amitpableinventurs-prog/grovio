import { apiClient, unwrap } from './client';
import type { Address } from '../types';

export type AddressInput = Omit<Address, '_id'>;

export function listAddresses() {
  return unwrap<Address[]>(apiClient.get('/customer/addresses'));
}

export function createAddress(payload: Partial<AddressInput>) {
  return unwrap<Address>(apiClient.post('/customer/addresses', payload));
}

export function updateAddress(id: string, payload: Partial<AddressInput>) {
  return unwrap<Address>(apiClient.put(`/customer/addresses/${id}`, payload));
}

export function deleteAddress(id: string) {
  return unwrap<null>(apiClient.delete(`/customer/addresses/${id}`));
}
