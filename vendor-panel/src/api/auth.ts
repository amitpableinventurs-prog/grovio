import { apiClient, unwrap } from './client';
import type { Store, User } from '../types';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  store: Store | null;
}

// Only vendor (store) accounts get in — the backend turns admins away with a 403.
export function login(email: string, password: string) {
  return unwrap<LoginResponse>(apiClient.post('/vendor/auth/login', { email, password, platform: 'web' }));
}

export function fetchMe() {
  return unwrap<{ user: User; store: Store | null }>(apiClient.get('/vendor/me'));
}

export function logout(refreshToken: string) {
  return apiClient.post('/auth/logout', { refreshToken });
}
