import { apiClient, unwrap } from './client';
import type { DashboardStats } from '../types';

export function fetchDashboardStats() {
  return unwrap<DashboardStats>(apiClient.get('/admin/dashboard'));
}
