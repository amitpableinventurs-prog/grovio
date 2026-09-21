import { apiClient, unwrap } from './client';
import type { Order } from '../types';

export interface RazorpayOrderResponse {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  orderId: string;
}

export function createRazorpayOrder(orderId: string) {
  return unwrap<RazorpayOrderResponse>(apiClient.post('/payments/razorpay/create', { orderId }));
}

export function verifyRazorpayPayment(payload: {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  return unwrap<Order>(apiClient.post('/payments/razorpay/verify', payload));
}

export function reportRazorpayFailure(payload: { orderId: string; razorpayOrderId: string; razorpayPaymentId?: string; reason?: string }) {
  return unwrap<Order>(apiClient.post('/payments/razorpay/failure', payload));
}
