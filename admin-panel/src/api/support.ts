import { apiClient, unwrap } from './client';
import type { Paginated, SupportTicket } from '../types';
import type { ListParams } from './common';

export function fetchTickets(params: ListParams = {}) {
  return unwrap<Paginated<SupportTicket>>(apiClient.get('/admin/support-tickets', { params }));
}

export function replyToTicket(id: string, data: { adminReply?: string; status?: string }) {
  return unwrap<SupportTicket>(apiClient.patch(`/admin/support-tickets/${id}`, data));
}
