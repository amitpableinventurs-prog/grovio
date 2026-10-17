import { apiClient, unwrap } from './client';
import type { Paginated, VoipCall, VoipConfig } from '../types';
import type { ListParams } from './common';

// Masked customer <-> delivery partner calls (in-app VoIP) — backend services/voip.service.js.
export function fetchVoipCalls(params: ListParams & { status?: string; orderId?: string } = {}) {
  return unwrap<Paginated<VoipCall>>(apiClient.get('/admin/voip/calls', { params }));
}

export function fetchVoipConfig() {
  return unwrap<VoipConfig>(apiClient.get('/admin/voip/config'));
}
