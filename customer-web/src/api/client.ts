import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1';
// Product/category/banner images come back as server-relative paths (e.g. "/uploads/x.jpg"),
// so build the origin (no /api/v1) once here to resolve them into absolute URLs.
export const ASSET_BASE_URL = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

export function resolveAssetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

export const apiClient = axios.create({ baseURL: API_BASE_URL });

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
    const { accessToken, refreshToken: newRefreshToken } = res.data.data;
    useAuthStore.setState({ accessToken, refreshToken: newRefreshToken });
    return accessToken;
  } catch {
    return null;
  }
}

// Shared by the axios interceptor below and the realtime socket (realtime/socket.ts), so concurrent
// 401s / socket auth failures trigger a single /auth/refresh call.
export function refreshAccessTokenOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isAuthEndpoint = original?.url?.includes('/auth/');

    if (error.response?.status === 401 && original && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      const newToken = await refreshAccessTokenOnce();
      if (newToken) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(original);
      }
      useAuthStore.getState().clear();
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

export function unwrap<T>(promise: Promise<{ data: { data: T } }>): Promise<T> {
  return promise.then((res) => res.data.data);
}

export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.message || fallback;
  }
  return fallback;
}
