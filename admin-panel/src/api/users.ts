import { apiClient, unwrap } from './client';
import type { Paginated, Role, UserWithProfile } from '../types';
import type { ListParams } from './common';

const ROLE_PATH: Record<Extract<Role, 'customer' | 'picker' | 'delivery'>, string> = {
  customer: 'customers',
  picker: 'pickers',
  delivery: 'delivery-partners',
};

export function fetchUsersByRole<T = UserWithProfile>(role: keyof typeof ROLE_PATH, params: ListParams = {}) {
  return unwrap<Paginated<T>>(apiClient.get(`/admin/${ROLE_PATH[role]}`, { params }));
}

export function fetchUserDetail<T = UserWithProfile>(id: string) {
  return unwrap<T>(apiClient.get(`/admin/users/${id}`));
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

export interface DeliveryPartnerInput {
  name: string;
  phone?: string;
  email?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  licenseNumber?: string;
  bankDetails?: { accountHolderName?: string; accountNumber?: string; ifsc?: string; bankName?: string };
}

export function createDeliveryPartner(data: DeliveryPartnerInput) {
  return unwrap(apiClient.post('/admin/delivery-partners', data));
}

export function updateDeliveryPartner(userId: string, data: Partial<DeliveryPartnerInput>) {
  return unwrap(apiClient.put(`/admin/delivery-partners/${userId}`, data));
}

export function deleteDeliveryPartner(userId: string) {
  return unwrap(apiClient.delete(`/admin/delivery-partners/${userId}`));
}

export function toggleUserActive(userId: string, isActive: boolean) {
  return unwrap(apiClient.patch(`/admin/users/${userId}/active`, { isActive }));
}
