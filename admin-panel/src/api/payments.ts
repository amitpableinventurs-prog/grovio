import { apiClient, unwrap } from './client';
import type { Paginated, Payment, Refund } from '../types';
import type { ListParams } from './common';

export function fetchPayments(params: ListParams = {}) {
  return unwrap<Paginated<Payment>>(apiClient.get('/admin/payments', { params }));
}

export function fetchCodReconciliation(params: { from?: string; to?: string } = {}) {
  return unwrap<{ totalOrders: number; totalCollected: number; unsettledCount: number; orders: unknown[] }>(
    apiClient.get('/admin/payments/cod-reconciliation', { params })
  );
}

export function fetchRefunds(params: ListParams = {}) {
  return unwrap<Paginated<Refund>>(apiClient.get('/admin/refunds', { params }));
}
