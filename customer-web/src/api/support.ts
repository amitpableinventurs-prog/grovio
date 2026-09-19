import { apiClient, unwrap } from './client';
import type { Paginated } from '../types';

export interface SupportTicket {
  _id: string;
  user: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  adminReply?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createTicket(subject: string, message: string) {
  return unwrap<SupportTicket>(apiClient.post('/common/support', { subject, message }));
}

export function listMyTickets() {
  return unwrap<Paginated<SupportTicket>>(apiClient.get('/common/support', { params: { limit: 50 } }));
}
