import { apiClient, unwrap } from './client';

// Delivery partner gigs (bookable shifts) — backend controllers/admin/riderPrograms.controller.js.

export interface Gig {
  _id: string;
  store?: { _id: string; name: string } | null;
  startAt: string;
  endAt: string;
  payPerHourMin?: number | null;
  payPerHourMax?: number | null;
  capacity?: number | null;
  bookedCount: number;
  minLoginMinutes: number;
  isFree: boolean;
  isPriority: boolean;
  note?: string | null;
  status: 'active' | 'cancelled';
}

export interface GigDaySummary {
  date: string;
  label: string;
  weekday: string;
  gigs: number;
  booked: number;
  seats: number | null;
}

export interface GigBooking {
  _id: string;
  rider?: { _id: string; name: string; phone?: string } | null;
  status: 'booked' | 'completed' | 'incomplete' | 'cancelled';
  exempted: boolean;
  exemptReason?: string | null;
  loginMinutes?: number | null;
  trips?: number | null;
  earnings?: number | null;
  createdAt: string;
}

export interface GigSlotInput {
  from: string; // HH:mm
  to: string; // HH:mm (00:00 = midnight)
  payPerHourMin?: number | null;
  payPerHourMax?: number | null;
  capacity?: number | null;
  minLoginMinutes?: number;
  isFree?: boolean;
  isPriority?: boolean;
  note?: string;
}

export function fetchGigs(params: { date: string; days?: number; storeId?: string }) {
  return unwrap<{ date: string; days: number; summary: GigDaySummary[]; items: Gig[] }>(apiClient.get('/admin/gigs', { params }));
}

export function createGigs(body: { storeId?: string | null; dates: string[]; slots: GigSlotInput[] }) {
  return unwrap<{ created: number; skipped: number }>(apiClient.post('/admin/gigs/bulk', body));
}

export function updateGig(id: string, body: Partial<GigSlotInput> & { note?: string | null }) {
  return unwrap<Gig>(apiClient.patch(`/admin/gigs/${id}`, body));
}

export function cancelGig(id: string) {
  return unwrap<Gig>(apiClient.delete(`/admin/gigs/${id}`));
}

export function fetchGigBookings(id: string) {
  return unwrap<GigBooking[]>(apiClient.get(`/admin/gigs/${id}/bookings`));
}

export function exemptGigBooking(id: string, exempted: boolean, reason?: string) {
  return unwrap<GigBooking>(apiClient.patch(`/admin/gig-bookings/${id}/exempt`, { exempted, reason }));
}
