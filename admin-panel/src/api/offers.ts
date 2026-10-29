import { apiClient, unwrap } from './client';
import type { Paginated } from '../types';

// Delivery partner incentive offers — backend controllers/admin/riderPrograms.controller.js and
// services/offer.service.js. A tier unlocks once a partner meets all of its requirements; when the
// offer ends the highest unlocked tier is paid.

export type OfferStatus = 'live' | 'upcoming' | 'expired' | 'cancelled';

export interface OfferTier {
  incentive: number;
  minGigs?: number | null;
  minOrders?: number | null;
  minEarnings?: number | null;
}

export interface LoginWindow {
  from: string; // HH:mm
  to: string; // HH:mm (earlier than from = past midnight)
  minMinutes: number;
}

export interface OfferConditions {
  maxOrderDenials?: number | null;
  maxCancellations?: number | null;
  maxIncompleteGigs?: number | null;
}

export interface OfferRider {
  _id: string;
  name: string;
  phone?: string;
}

export interface IncentiveOffer {
  _id: string;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  // ids in the list, { _id, name, phone } from fetchOffer
  riders: (string | OfferRider)[];
  tiers: OfferTier[];
  conditions?: OfferConditions;
  compulsoryLogin: LoginWindow[];
  videoUrl?: string | null;
  status: OfferStatus;
  spanLabel: string;
  maxIncentive: number;
  settledAt?: string | null;
}

export interface OfferInput {
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  riders: string[];
  tiers: OfferTier[];
  conditions: OfferConditions;
  compulsoryLogin: LoginWindow[];
  videoUrl?: string | null;
}

export interface OfferRiderProgress {
  rider: OfferRider;
  status: 'in_progress' | 'disqualified' | 'paid' | 'not_achieved';
  amount: number;
  tierIndex: number | null;
  tiers: { incentive: number; locked: boolean }[];
  reason?: string | null;
  progress?: { gigs: number; orders: number; earnings: number; orderDenials: number; cancellations: number; incompleteGigs: number } | null;
}

export function fetchOffers(params: { status?: OfferStatus; page?: number; limit?: number }) {
  return unwrap<Paginated<IncentiveOffer>>(apiClient.get('/admin/offers', { params }));
}

export function fetchOffer(id: string) {
  return unwrap<IncentiveOffer>(apiClient.get(`/admin/offers/${id}`));
}

export function createOffer(body: OfferInput) {
  return unwrap<IncentiveOffer>(apiClient.post('/admin/offers', body));
}

export function updateOffer(id: string, body: OfferInput) {
  return unwrap<IncentiveOffer>(apiClient.put(`/admin/offers/${id}`, body));
}

export function cancelOffer(id: string) {
  return unwrap<IncentiveOffer>(apiClient.delete(`/admin/offers/${id}`));
}

export function fetchOfferRiders(id: string) {
  return unwrap<OfferRiderProgress[]>(apiClient.get(`/admin/offers/${id}/riders`));
}

export function settleOffer(id: string) {
  return unwrap<{ riders: number; paid: number; total: number }>(apiClient.post(`/admin/offers/${id}/settle`));
}
