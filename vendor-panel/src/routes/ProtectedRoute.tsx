import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

// Only a signed-in vendor gets past this; the backend checks it's a vendor account on every call.
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { accessToken, user } = useAuthStore();
  if (!accessToken || !user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
