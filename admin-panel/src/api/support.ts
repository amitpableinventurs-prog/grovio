import { apiClient, unwrap } from './client';
import type { Paginated, SupportTicket } from '../types';
import type { ListParams } from './common';

export function fetchTickets(params: ListParams = {}) {
  return unwrap<Paginated<SupportTicket>>(apiClient.get('/admin/support-tickets', { params }));
}

export function replyToTicket(id: string, data: { adminReply?: string; status?: string }) {
  return unwrap<SupportTicket>(apiClient.patch(`/admin/support-tickets/${id}`, data));
}

export function fetchTicket(id: string) {
  return unwrap<SupportTicket>(apiClient.get(`/admin/support-tickets/${id}`));
}

export function markTicketRead(id: string) {
  return unwrap<{ ticketId: string; readAt: string }>(apiClient.post(`/admin/support-tickets/${id}/read`));
}
