import { apiClient, unwrap } from './client';

// Delivery partner KM + incentive pay (backend services/riderPay.service.js).

export interface RiderPayPolicy {
  kmSlabs: { upToKm: number; amount: number }[];
  perKmBeyond: number;
  peak: { amount: number; highSurgeAmount: number; windows: { from: string; to: string }[] };
  rain: { normal: number; heavy: number; severe: number };
  heavyLoad: { minKg: number; amount: number }[];
  waiting: { freeMinutes: number; perMinute: number; maxPay: number | null };
  cancellation: { arrivedAtPickup: number; pickedUp: number };
  daily: { deliveries: number; amount: number; tier: string | null }[];
  weekly: { deliveries: number; amount: number }[];
  guarantee: { enabled: boolean; amount: number; minOnlineMinutes: number; minDeliveries: number; requireGig: boolean };
  eligibility: { maxCancellationRatePct: number; minOrdersForRate: number };
  settleDelayHours: number;
  level?: 'default' | 'partner';
}

export interface PayQuote {
  mappedDistanceKm: number | null;
  kmSlab: string;
  basePayout: number;
  peakBonus: number;
  rainBonus: number;
  heavyLoadBonus: number;
  weightKg: number | null;
  total: number;
}

export type RainLevel = 'none' | 'normal' | 'heavy' | 'severe';
export type SurgeLevel = 'none' | 'high';

export interface HubConditions {
  storeId: string;
  storeName: string;
  rain: RainLevel;
  surge: SurgeLevel;
  since: string | null;
  until: string | null;
  active: { rain: RainLevel; surge: SurgeLevel };
}

export type PayoutStatus = 'pending' | 'settling' | 'paid' | 'nothing_due' | 'not_eligible' | 'withheld';

export interface PayLine { key: string; label: string; amount: number }

export interface LivePeriod {
  kind: 'day' | 'week';
  key: string;
  label: string;
  deliveries: number;
  orderEarnings: number;
  cancellations: number;
  cancellationRatePct: number;
  tier?: string | null;
  nextSlab: { deliveries: number; amount: number; tier?: string | null; deliveriesToGo: number } | null;
  eligibility: { eligible: boolean; reasons: string[] };
  guarantee?: { enabled: boolean; amount: number; eligible: boolean; topUp: number };
  lines: PayLine[];
  incentives: number;
  total: number;
  payoutStatus: PayoutStatus;
  estimate: boolean;
  withheld: { reason: string | null; at: string | null } | null;
}

export interface PayPeriodRow {
  id: string;
  kind: 'day' | 'week';
  key: string;
  label: string;
  deliveries: number | null;
  lines: PayLine[];
  total: number;
  payoutStatus: PayoutStatus;
  eligibility: { status: 'eligible' | 'ineligible' | null; reasons: string[] };
  withheld: { reason: string; at: string } | null;
  settledAt: string | null;
  audit: { action: string; note: string | null; amount: number | null; at: string }[];
}

export function fetchRiderPayPolicy() {
  return unwrap<{ policy: RiderPayPolicy; defaults: RiderPayPolicy }>(apiClient.get('/admin/rider-pay/policy'));
}

export function saveRiderPayPolicy(patch: Partial<RiderPayPolicy>) {
  return unwrap<RiderPayPolicy>(apiClient.put('/admin/rider-pay/policy', patch));
}

export function previewRiderPay(params: { km: number; kg?: number | null; time?: string; rain?: RainLevel; surge?: SurgeLevel }) {
  return unwrap<PayQuote>(apiClient.get('/admin/rider-pay/preview', { params }));
}

export function fetchHubConditions() {
  return unwrap<HubConditions[]>(apiClient.get('/admin/rider-pay/conditions'));
}

export function setHubConditions(storeId: string, data: { rain: RainLevel; surge: SurgeLevel; until?: string | null }) {
  return unwrap<HubConditions>(apiClient.put(`/admin/stores/${storeId}/rider-conditions`, data));
}

export function fetchRiderPayPeriods(riderId: string) {
  return unwrap<{ live: { day: LivePeriod | null; week: LivePeriod | null }; periods: PayPeriodRow[] }>(apiClient.get(`/admin/delivery-partners/${riderId}/pay-periods`));
}

export function withholdPayPeriod(riderId: string, kind: 'day' | 'week', key: string, reason: string) {
  return unwrap(apiClient.post(`/admin/delivery-partners/${riderId}/pay-periods/${kind}/${key}/withhold`, { reason }));
}

export function releasePayPeriod(riderId: string, kind: 'day' | 'week', key: string, note?: string) {
  return unwrap(apiClient.post(`/admin/delivery-partners/${riderId}/pay-periods/${kind}/${key}/release`, { note }));
}
