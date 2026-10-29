import { apiClient, unwrap } from './client';
import type { PageMeta } from '../types';

// Error logs — backend controllers/admin/errorLogs.controller.js. The backend logs its own
// errors; the apps report theirs through POST /common/error-logs.

export type ErrorSource = 'backend' | 'mobile' | 'web';
export type ErrorApp = 'backend' | 'customer' | 'picker' | 'delivery' | 'vendor' | 'admin';
export type ErrorLevel = 'fatal' | 'error' | 'warning';

export interface ErrorLog {
  _id: string;
  source: ErrorSource;
  app: ErrorApp;
  level: ErrorLevel;
  message: string;
  occurredAt: string;
  createdAt: string;
  method?: string | null;
  url?: string | null;
  statusCode?: number | null;
  screen?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  deviceModel?: string | null;
  osVersion?: string | null;
  user?: { _id: string; name: string; phone?: string; email?: string } | null;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  // detail only
  stack?: string | null;
  context?: Record<string, unknown> | null;
}

export interface ErrorLogFilters {
  from?: string;
  to?: string;
  source?: ErrorSource;
  app?: ErrorApp;
  level?: ErrorLevel;
  search?: string;
}

export function fetchErrorLogs(params: ErrorLogFilters & { page?: number; limit?: number; sort?: 'newest' | 'oldest' }) {
  return unwrap<{ items: ErrorLog[]; meta: PageMeta; summary: Record<ErrorSource, number> }>(apiClient.get('/admin/error-logs', { params }));
}

export function fetchErrorLog(id: string) {
  return unwrap<ErrorLog>(apiClient.get(`/admin/error-logs/${id}`));
}

export function deleteErrorLog(id: string) {
  return unwrap<null>(apiClient.delete(`/admin/error-logs/${id}`));
}

export function clearErrorLogs(params: ErrorLogFilters) {
  return unwrap<{ deleted: number }>(apiClient.delete('/admin/error-logs', { params }));
}
