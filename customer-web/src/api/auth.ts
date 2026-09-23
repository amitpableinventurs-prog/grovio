import { apiClient, unwrap } from './client';
import type { User } from '../types';

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: User;
  isNewUser?: boolean;
}

// `phone` is the 10-digit number only — the backend assumes +91.
export function sendOtp(phone: string) {
  return unwrap<{ sent: boolean; resendCooldownSeconds: number; debugOtp?: string }>(
    apiClient.post('/auth/send-otp', { phone })
  );
}

export function resendOtp(phone: string) {
  return unwrap<{ sent: boolean; resendCooldownSeconds: number; debugOtp?: string }>(
    apiClient.post('/auth/resend-otp', { phone })
  );
}

export function verifyOtp(phone: string, otp: string) {
  return unwrap<AuthSession>(apiClient.post('/auth/verify-otp', { phone, otp, role: 'customer' }));
}

export function getMe() {
  return unwrap<User>(apiClient.get('/me'));
}

export function updateMe(payload: Partial<Pick<User, 'name' | 'email' | 'gender' | 'profileImage'>>) {
  return unwrap<User>(apiClient.put('/me', payload));
}

export function logout(refreshToken: string) {
  return unwrap<null>(apiClient.post('/auth/logout', { refreshToken }));
}
