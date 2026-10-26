import { apiClient, unwrap } from './client';
import type { Paginated } from '../types';
import type { ListParams } from './common';

// COD cash delivery partners collect at the door and hand in at the hub — backend
// services/pocket.service.js (adminCashBook / adminCashLedger / recordHubDeposit).

export interface CashPosition {
  rider: { _id: string; name: string; phone?: string | null; isActive?: boolean };
  balance: number;
  // Same figure the delivery app asks the partner to deposit (a negative pocket balance).
  cashToDeposit: number;
  cashCollected: number;
  deposited: number;
  lastCollectedAt: string | null;
  lastDepositAt: string | null;
}

export interface CashTotals {
  cashWithRiders: number;
  ridersHolding: number;
  collectedToday: number;
  depositedToday: number;
}

export interface CashLedgerEntry {
  id: string;
  category: 'cash_collected' | 'cash_deposit';
  title: string;
  subtitle: string | null;
  // Negative = cash collected, positive = deposited.
  amount: number;
  at: string;
  balanceAfter: number;
}

export function fetchCashCollection(params: ListParams & { holding?: 'true' } = {}) {
  return unwrap<Paginated<CashPosition> & { totals: CashTotals }>(apiClient.get('/admin/cash-collection', { params }));
}

export function fetchCashLedger(riderId: string, params: ListParams = {}) {
  return unwrap<Paginated<CashLedgerEntry>>(apiClient.get(`/admin/delivery-partners/${riderId}/cash-ledger`, { params }));
}

export function recordCashDeposit(riderId: string, data: { amount: number; reference?: string | null }) {
  return unwrap(apiClient.post(`/admin/delivery-partners/${riderId}/cash-deposits`, data));
}
