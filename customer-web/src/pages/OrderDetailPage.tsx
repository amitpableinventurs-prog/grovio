import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import * as ordersApi from '../api/orders';
import { apiErrorMessage } from '../api/client';
import { formatPrice } from '../utils/format';
import OrderStatusBadge from '../components/OrderStatusBadge';
import BillBreakdown from '../components/BillBreakdown';
import Loader from '../components/Loader';
import { useState } from 'react';

const CANCELLABLE = ['placed', 'accepted', 'picking'];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: () => ordersApi.getOrder(id as string),
    enabled: !!id,
  });

  const cancelMutation = useMutation({
    mutationFn: () => ordersApi.cancelOrder(id as string, 'Cancelled by customer'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => setError(apiErrorMessage(err, 'Could not cancel order')),
  });

  if (isLoading) return <Loader />;
  if (!order) return <p className="text-center text-gray-500 py-20">Order not found.</p>;

  const store = typeof order.store === 'object' ? order.store : null;
  const address = typeof order.address === 'object' ? order.address : null;

  return (
    <div className="grid gap-8 md:grid-cols-3">
      <div className="md:col-span-2 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{order.orderNumber}</h1>
            <p className="text-sm text-gray-500">{new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <OrderStatusBadge status={order.orderStatus} />
        </div>

        {order.orderStatus === 'placed' && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800">
            Waiting for the store to confirm your order. This page updates on its own as soon as they do.
          </div>
        )}

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-3">Order Status</h2>
          <ol className="flex flex-col gap-3">
            {order.statusLogs.map((log, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span className="h-2 w-2 rounded-full bg-brand-600 shrink-0" />
                <span className="font-medium text-gray-800 capitalize">{log.status.replace(/_/g, ' ')}</span>
                <span className="ml-auto text-xs text-gray-400">{new Date(log.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-3">{store?.name || 'Store'}</h2>
          <div className="flex flex-col divide-y divide-gray-100">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="font-medium text-gray-800">{item.nameSnapshot}</p>
                  <p className="text-xs text-gray-500">Qty {item.qty}</p>
                </div>
                <span className="font-medium text-gray-900">{formatPrice(item.price * item.qty)}</span>
              </div>
            ))}
          </div>
        </section>

        {address && (
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold text-gray-900 mb-2">Delivery Address</h2>
            <p className="text-sm text-gray-600">
              {[address.line1, address.landmark, address.city, address.state, address.pincode].filter(Boolean).join(', ')}
            </p>
          </section>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 h-fit">
        <h2 className="font-semibold text-gray-900 mb-4">Bill Details</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <BillBreakdown bill={order} />
        </div>
        <div className="mt-3 flex justify-between border-t border-gray-200 pt-3 font-bold text-gray-900">
          <span>Total Payable</span>
          <span>{formatPrice(order.grandTotal)}</span>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Payment: {order.paymentMethod} · {order.paymentStatus}
        </p>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {CANCELLABLE.includes(order.orderStatus) && (
          <button
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="mt-4 w-full rounded-lg border border-red-300 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50"
          >
            {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Order'}
          </button>
        )}
      </div>
    </div>
  );
}
