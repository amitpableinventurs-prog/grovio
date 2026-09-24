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

// PayU hosted checkout: submit these fields as a form POST to `action` (see utils/gatewayRedirect.ts).
export function createPayuPayment(orderId: string) {
  return unwrap<{ action: string; fields: Record<string, string> }>(apiClient.post('/payments/payu/create', { orderId }));
}

// PhonePe: send the customer to redirectUrl; they come back to /payment/return.
export function createPhonepePayment(orderId: string) {
  return unwrap<{ redirectUrl: string; merchantOrderId: string }>(apiClient.post('/payments/phonepe/create', { orderId }));
}

// Asks the backend to check the order's PhonePe payment with PhonePe (never trust the redirect).
export function verifyPhonepePayment(orderId: string) {
  return unwrap<{ order: Order; paymentStatus: string }>(apiClient.post('/payments/phonepe/verify', { orderId }));
}
