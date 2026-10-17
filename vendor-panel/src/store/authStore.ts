import { create } from 'zustand';
import type { Store, User } from '../types';

interface Session {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  store: Store | null;
}

interface AuthState extends Session {
  setSession: (session: { accessToken: string; refreshToken: string; user: User; store: Store | null }) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setProfile: (profile: { user: User; store: Store | null }) => void;
  clear: () => void;
}

const STORAGE_KEY = 'grovio_vendor_auth';
const EMPTY: Session = { accessToken: null, refreshToken: null, user: null, store: null };

function loadInitial(): Session {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function persist(state: Session) {
  try {
    if (!state.accessToken) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable — session just won't survive a refresh.
  }
}

const snapshot = (s: Session): Session => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user, store: s.store });

export const useAuthStore = create<AuthState>((set, get) => ({
  ...loadInitial(),
  setSession: (session) => {
    persist(session);
    set(session);
  },
  setTokens: (accessToken, refreshToken) => {
    set({ accessToken, refreshToken });
    persist(snapshot(get()));
  },
  setProfile: ({ user, store }) => {
    set({ user, store });
    persist(snapshot(get()));
  },
  clear: () => {
    persist(EMPTY);
    set(EMPTY);
  },
}));
