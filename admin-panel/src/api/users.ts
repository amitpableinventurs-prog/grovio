import { apiClient, unwrap } from './client';
import type { Paginated, Role, UserWithProfile } from '../types';
import type { ListParams } from './common';

const ROLE_PATH: Record<Extract<Role, 'customer' | 'picker' | 'delivery'>, string> = {
  customer: 'customers',
  picker: 'pickers',
  delivery: 'delivery-partners',
};

export function fetchUsersByRole(role: keyof typeof ROLE_PATH, params: ListParams = {}) {
  return unwrap<Paginated<UserWithProfile>>(apiClient.get(`/admin/${ROLE_PATH[role]}`, { params }));
}

export function fetchUserDetail(id: string) {
  return unwrap<UserWithProfile>(apiClient.get(`/admin/users/${id}`));
}

export function updatePickerStatus(userId: string, status: string) {
  return unwrap(apiClient.patch(`/admin/pickers/${userId}/status`, { status }));
}

export function assignPickerToStore(userId: string, storeId: string | null) {
  return unwrap(apiClient.patch(`/admin/pickers/${userId}/assign-store`, { storeId }));
}

export function updateDeliveryStatus(userId: string, status: string) {
  return unwrap(apiClient.patch(`/admin/delivery-partners/${userId}/status`, { status }));
}

export function toggleUserActive(userId: string, isActive: boolean) {
  return unwrap(apiClient.patch(`/admin/users/${userId}/active`, { isActive }));
}
