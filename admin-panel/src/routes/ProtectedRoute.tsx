import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { hasPermission } from '../utils/permissions';
import { Result } from 'antd';

interface Props {
  children: ReactNode;
  requiredPermissions?: string[];
}

export default function ProtectedRoute({ children, requiredPermissions }: Props) {
  const { accessToken, user } = useAuthStore();

  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/login" replace />;
  }

  if (requiredPermissions && !hasPermission(user.permissions, ...requiredPermissions)) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="Aapke paas is page ko dekhne ki permission nahi hai."
      />
    );
  }

  return <>{children}</>;
}
