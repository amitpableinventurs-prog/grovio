import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { useAuthStore } from '../store/authStore';
import { formatCurrency } from '../utils/format';
import { connectSocket, disconnectSocket, onSocketEvent, type OrderEventPayload } from './socket';

// Mounted once in AdminLayout: keeps the socket connected for the logged-in admin and refreshes
// every order-related query when the backend pushes an order change, so the Orders table, the
// open order drawer and the dashboard stay live without polling.
export function useOrderRealtime() {
  const userId = useAuthStore((s) => s.user?._id);
  const queryClient = useQueryClient();
  const { notification } = AntApp.useApp();

  useEffect(() => {
    if (!userId) return;
    connectSocket();

    const refreshOrderLists = () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['cod-reconciliation'] });
    };

    const onUpdated = (e: OrderEventPayload) => {
      refreshOrderLists();
      queryClient.invalidateQueries({ queryKey: ['order-detail', e.orderId] });
      queryClient.invalidateQueries({ queryKey: ['order-scanner-logs', e.orderId] });
    };

    const onCreated = (e: OrderEventPayload) => {
      onUpdated(e);
      notification.info({
        key: `order-created-${e.orderId}`,
        message: 'New order',
        description: `${e.orderNumber} · ${formatCurrency(e.grandTotal)} · ${e.paymentMethod}`,
        placement: 'bottomRight',
      });
    };

    // Anything pushed while we were disconnected was missed — refetch on every reconnect.
    let firstConnect = true;
    const onConnect = () => {
      if (!firstConnect) refreshOrderLists();
      firstConnect = false;
    };

    const offs = [
      onSocketEvent('order:created', onCreated),
      onSocketEvent('order:updated', onUpdated),
      onSocketEvent('connect', onConnect),
    ];
    return () => {
      offs.forEach((off) => off());
      disconnectSocket();
    };
  }, [userId, queryClient, notification]);
}
