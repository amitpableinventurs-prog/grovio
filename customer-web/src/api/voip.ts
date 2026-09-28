import { apiClient, unwrap } from './client';

// Masked in-app calls with the delivery partner — backend services/voip.service.js. The API never
// returns the rider's phone number; calls go app to app over Twilio Voice.

export interface VoipToken {
  // false = in-app calling is switched off (no other fields).
  enabled: boolean;
  identity?: string;
  token?: string;
  ttlSec?: number;
  expiresAt?: string;
}

export interface StartedCall {
  callId: string;
  // No provider configured: recorded server-side, nothing is dialled.
  simulated: boolean;
  orderNumber: string;
  callee: { role: 'customer' | 'delivery'; name: string };
  // Passed to device.connect({ params }).
  params: Record<string, string>;
}

export function getVoipToken() {
  return unwrap<VoipToken>(apiClient.get('/voip/token', { params: { platform: 'web' } }));
}

export function callDeliveryPartner(orderId: string) {
  return unwrap<StartedCall>(apiClient.post(`/customer/orders/${orderId}/call`));
}
