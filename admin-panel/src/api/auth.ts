import { apiClient, unwrap } from './client';
import type { User } from '../types';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export function login(email: string, password: string) {
  return unwrap<LoginResponse>(apiClient.post('/auth/login', { email, password }));
}

export function fetchMe() {
  return unwrap<User>(apiClient.get('/auth/me'));
}

export function logout(refreshToken: string) {
  return apiClient.post('/auth/logout', { refreshToken });
}
