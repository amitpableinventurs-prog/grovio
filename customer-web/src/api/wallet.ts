import { apiClient, unwrap } from './client';
import type { Paginated } from '../types';

export interface WalletTransaction {
  _id: string;
  type: 'credit' | 'debit';
  amount: number;
  reason: string;
  refOrderId: string | null;
  balanceAfter: number;
  createdAt: string;
}

export interface AddMoneyOrderResponse {
  paymentId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export function fetchWalletBalance() {
  return unwrap<{ balance: number }>(apiClient.get('/customer/wallet'));
}

export function fetchWalletTransactions(page = 1, limit = 20) {
  return unwrap<Paginated<WalletTransaction>>(apiClient.get('/customer/wallet/transactions', { params: { page, limit } }));
}

export function createAddMoney(amount: number) {
  return unwrap<AddMoneyOrderResponse>(apiClient.post('/customer/wallet/add-money/create', { amount }));
}

export function verifyAddMoney(payload: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
  return unwrap<{ balance: number }>(apiClient.post('/customer/wallet/add-money/verify', payload));
}

export function retryAddMoney(paymentId: string) {
  return unwrap<AddMoneyOrderResponse>(apiClient.post(`/customer/wallet/add-money/${paymentId}/retry`));
}
