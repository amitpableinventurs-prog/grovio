import { apiClient, unwrap } from './client';
import type { AdminActivityLog, Paginated, User } from '../types';
import type { ListParams } from './common';

export function fetchAdmins(params: ListParams = {}) {
  return unwrap<Paginated<User>>(apiClient.get('/admin/admins', { params }));
}

export function createAdmin(data: { name: string; email: string; password: string; permissions: string[] }) {
  return unwrap<User>(apiClient.post('/admin/admins', data));
}

export function updateAdminPermissions(id: string, permissions: string[]) {
  return unwrap<User>(apiClient.patch(`/admin/admins/${id}/permissions`, { permissions }));
}

export function fetchActivityLogs(params: ListParams = {}) {
  return unwrap<Paginated<AdminActivityLog>>(apiClient.get('/admin/activity-logs', { params }));
}
