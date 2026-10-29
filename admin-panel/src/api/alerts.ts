import { apiClient, unwrap } from './client';
import type { Paginated } from '../types';

// Alert messages the Customer / Picker / Delivery apps show — backend controllers/admin/alerts.controller.js.

export type AlertApp = 'customer' | 'picker' | 'delivery';
export type AlertSeverity = 'info' | 'success' | 'warning' | 'critical';
export type AlertDisplay = 'banner' | 'popup';
export type AlertStatus = 'live' | 'scheduled' | 'ended' | 'off';

export interface AppAlert {
  _id: string;
  title?: string | null;
  message: string;
  severity: AlertSeverity;
  display: AlertDisplay;
  apps: AlertApp[];
  dismissible: boolean;
  cta?: { label?: string | null; url?: string | null } | null;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive: boolean;
  status: AlertStatus;
  updatedBy?: { _id: string; name: string } | null;
  updatedAt: string;
}

export interface AlertInput {
  title: string | null;
  message: string;
  severity: AlertSeverity;
  display: AlertDisplay;
  apps: AlertApp[];
  dismissible: boolean;
  cta: { label: string; url: string } | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive?: boolean;
}

export function fetchAlerts(params: { status?: AlertStatus; app?: AlertApp; page?: number; limit?: number }) {
  return unwrap<Paginated<AppAlert>>(apiClient.get('/admin/alerts', { params }));
}

export function createAlert(body: AlertInput) {
  return unwrap<AppAlert>(apiClient.post('/admin/alerts', body));
}

export function updateAlert(id: string, body: AlertInput) {
  return unwrap<AppAlert>(apiClient.put(`/admin/alerts/${id}`, body));
}

export function setAlertActive(id: string, isActive: boolean) {
  return unwrap<AppAlert>(apiClient.patch(`/admin/alerts/${id}/active`, { isActive }));
}

export function deleteAlert(id: string) {
  return unwrap<null>(apiClient.delete(`/admin/alerts/${id}`));
}
