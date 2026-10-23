import { apiClient, unwrap } from './client';
import type { Paginated, SosAlert } from '../types';
import type { ListParams } from './common';

// SOS alerts from the Customer / Picker / Delivery apps — backend services/sos.service.js.
export function fetchSosAlerts(params: ListParams & { status?: string; role?: string } = {}) {
  return unwrap<Paginated<SosAlert> & { activeCount: number }>(apiClient.get('/admin/sos', { params }));
}

export function acknowledgeSos(id: string) {
  return unwrap<SosAlert>(apiClient.post(`/admin/sos/${id}/acknowledge`));
}

export function resolveSos(id: string, note: string) {
  return unwrap<SosAlert>(apiClient.post(`/admin/sos/${id}/resolve`, { note }));
}
