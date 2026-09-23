import { useQuery } from '@tanstack/react-query';
import { fetchOrders } from '../api/orders';
import { useSocketConnected } from '../realtime/socket';

// Orders waiting at 'placed' for someone to accept them — shared by the Live Orders board and the
// sidebar badge (same query key, so one request feeds both). The key starts with 'orders', so the
// realtime hook's invalidateQueries(['orders']) refreshes it the moment an order is placed or
// accepted; polling only kicks in as a fallback while the socket is disconnected.
export function useIncomingOrders(enabled = true) {
  const live = useSocketConnected();
  return useQuery({
    queryKey: ['orders', 'incoming'],
    queryFn: () => fetchOrders({ status: 'placed', limit: 100 }),
    enabled,
    refetchInterval: live ? false : 15_000,
    select: (data) => [...data.items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
  });
}
