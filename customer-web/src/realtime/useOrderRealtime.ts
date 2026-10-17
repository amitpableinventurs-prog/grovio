import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { connectSocket, disconnectSocket, onSocketEvent, type OrderEventPayload } from './socket';

// Mounted once in MainLayout: while a customer is logged in, keeps the socket connected and
// refreshes their order queries whenever the backend pushes a change to one of their orders
// (status moves, payment confirmation, cancellation/refund), so My Orders and the order detail
// page update live.
export function useOrderRealtime() {
  const userId = useAuthStore((s) => s.user?._id);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    connectSocket();

    const refreshLists = () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      // Cancellations/returns refund prepaid orders to the wallet.
      queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
    };

    const onOrderChange = (e: OrderEventPayload) => {
      refreshLists();
      queryClient.invalidateQueries({ queryKey: ['order', e.orderId] });
    };

    // Anything pushed while we were disconnected was missed — refetch on every reconnect.
    let firstConnect = true;
    const onConnect = () => {
      if (!firstConnect) {
        refreshLists();
        queryClient.invalidateQueries({ queryKey: ['order'] });
      }
      firstConnect = false;
    };

    const offs = [
      onSocketEvent('order:created', onOrderChange),
      onSocketEvent('order:updated', onOrderChange),
      onSocketEvent('connect', onConnect),
    ];
    return () => {
      offs.forEach((off) => off());
      disconnectSocket();
    };
  }, [userId, queryClient]);
}
