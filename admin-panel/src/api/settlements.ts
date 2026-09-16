import { apiClient, unwrap } from './client';
import type { Paginated, Settlement } from '../types';
import type { ListParams } from './common';

export function fetchSettlements(params: ListParams = {}) {
  return unwrap<Paginated<Settlement>>(apiClient.get('/admin/settlements', { params }));
}

export function generateSettlement(data: { vendorId: string; from?: string; to?: string }) {
  return unwrap<Settlement>(apiClient.post('/admin/settlements/generate', data));
}

export function markSettlementPaid(id: string) {
  return unwrap<Settlement>(apiClient.patch(`/admin/settlements/${id}/pay`));
}
