import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { startDevice } from './voipStore';

// Mounted once in MainLayout: while a customer is logged in, keeps a Twilio Device registered so
// the delivery partner can call them in-app (see voipStore.ts).
export function useVoip() {
  const userId = useAuthStore((s) => s.user?._id);

  useEffect(() => {
    if (!userId) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    startDevice()
      .then((cleanup) => {
        if (cancelled) cleanup();
        else stop = cleanup;
      })
      .catch((err) => console.warn('In-app calling unavailable:', err?.message));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [userId]);
}
