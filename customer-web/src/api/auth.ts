import { apiClient, unwrap } from './client';
import type { User } from '../types';

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: User;
  isNewUser?: boolean;
}

// `mobile` is the 10-digit number only — the backend assumes +91.
export function sendOtp(mobile: string) {
  return unwrap<{ sent: boolean; resendCooldownSeconds: number; debugOtp?: string }>(
    apiClient.post('/auth/send-otp', { mobile })
  );
}

export function resendOtp(mobile: string) {
  return unwrap<{ sent: boolean; resendCooldownSeconds: number; debugOtp?: string }>(
    apiClient.post('/auth/resend-otp', { mobile })
  );
}

export function verifyOtp(mobile: string, otp: string) {
  return unwrap<AuthSession>(apiClient.post('/auth/verify-otp', { mobile, otp, role: 'customer' }));
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
