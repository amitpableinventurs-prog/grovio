import { apiClient, unwrap } from './client';
import type { DashboardRange, DashboardStats } from '../types';

export function fetchDashboardStats(range: DashboardRange = '30d') {
  return unwrap<DashboardStats>(apiClient.get('/admin/dashboard', { params: { range } }));
}
