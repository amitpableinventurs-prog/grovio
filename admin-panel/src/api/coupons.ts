import { apiClient, unwrap } from './client';
import type { Coupon } from '../types';

export function fetchCoupons() {
  return unwrap<Coupon[]>(apiClient.get('/admin/coupons'));
}

export function createCoupon(data: Partial<Coupon>) {
  return unwrap<Coupon>(apiClient.post('/admin/coupons', data));
}

export function updateCoupon(id: string, data: Partial<Coupon>) {
  return unwrap<Coupon>(apiClient.patch(`/admin/coupons/${id}`, data));
}

export function deleteCoupon(id: string) {
  return unwrap(apiClient.delete(`/admin/coupons/${id}`));
}
