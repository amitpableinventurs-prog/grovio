import { apiClient, unwrap } from './client';
import type { Paginated, Settlement } from '../types';
import type { ListParams } from './common';

export function fetchSettlements(params: ListParams = {}) {
  return unwrap<Paginated<Settlement>>(apiClient.get('/admin/settlements', { params }));
}

export function markSettlementPaid(id: string) {
  return unwrap<Settlement>(apiClient.patch(`/admin/settlements/${id}/pay`));
}
