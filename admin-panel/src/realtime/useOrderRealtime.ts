import { createElement, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { App as AntApp, Button } from 'antd';
import { useAuthStore } from '../store/authStore';
import { formatCurrency } from '../utils/format';
import { connectSocket, disconnectSocket, onSocketEvent, type OrderEventPayload } from './socket';
import { playNewOrderSound } from './newOrderSound';

// Mounted once in AdminLayout: keeps the socket connected for the logged-in admin and refreshes
// every order-related query when the backend pushes an order change, so the Orders table, the
// open order drawer and the dashboard stay live without polling.
export function useOrderRealtime() {
  const userId = useAuthStore((s) => s.user?._id);
  const queryClient = useQueryClient();
  const { notification } = AntApp.useApp();
  // Held in a ref: navigate can change identity on route changes, and it must not be an effect
  // dependency or every page change would reconnect the socket.
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

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
      playNewOrderSound();
      const key = `order-created-${e.orderId}`;
      notification.info({
        key,
        title: 'New order',
        description: `${e.orderNumber} · ${formatCurrency(e.grandTotal)} · ${e.paymentMethod}`,
        placement: 'bottomRight',
        // Waiting orders need someone to accept them — link straight to the board.
        actions: e.orderStatus === 'placed'
          ? createElement(Button, { type: 'primary', size: 'small', onClick: () => { notification.destroy(key); navigateRef.current('/live-orders'); } }, 'Open Live Orders')
          : undefined,
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
