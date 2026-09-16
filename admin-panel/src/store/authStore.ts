import { create } from 'zustand';
import type { User } from '../types';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  isHydrated: boolean;
  setSession: (session: { accessToken: string; refreshToken: string; user: User }) => void;
  setAccessToken: (accessToken: string) => void;
  clear: () => void;
}

const STORAGE_KEY = 'grovio_admin_auth';

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accessToken: null, refreshToken: null, user: null };
    return JSON.parse(raw);
  } catch {
    return { accessToken: null, refreshToken: null, user: null };
  }
}

function persist(state: { accessToken: string | null; refreshToken: string | null; user: User | null }) {
  try {
    if (!state.accessToken) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // localStorage unavailable — session just won't survive a refresh.
  }
}

const initial = loadInitial();

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: initial.accessToken,
  refreshToken: initial.refreshToken,
  user: initial.user,
  isHydrated: true,
  setSession: ({ accessToken, refreshToken, user }) => {
    persist({ accessToken, refreshToken, user });
    set({ accessToken, refreshToken, user });
  },
  setAccessToken: (accessToken) => {
    const { refreshToken, user } = get();
    persist({ accessToken, refreshToken, user });
    set({ accessToken });
  },
  clear: () => {
    persist({ accessToken: null, refreshToken: null, user: null });
    set({ accessToken: null, refreshToken: null, user: null });
  },
}));
