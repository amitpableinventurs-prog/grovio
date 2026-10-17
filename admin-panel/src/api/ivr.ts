import { apiClient, unwrap } from './client';
import type { IvrCall, IvrConfig, Paginated } from '../types';
import type { ListParams } from './common';

export function fetchIvrCalls(params: ListParams & { type?: string; status?: string; orderId?: string } = {}) {
  return unwrap<Paginated<IvrCall>>(apiClient.get('/admin/ivr/calls', { params }));
}

export function fetchIvrConfig() {
  return unwrap<IvrConfig>(apiClient.get('/admin/ivr/config'));
}

// kind 'status' reads out the order's current status; 'confirmation' asks a COD customer to
// press 1 (confirm) or 2 (cancel).
export function callCustomer(orderId: string, kind: 'status' | 'confirmation') {
  return unwrap<IvrCall>(apiClient.post(`/admin/orders/${orderId}/ivr-call`, { kind }));
}
