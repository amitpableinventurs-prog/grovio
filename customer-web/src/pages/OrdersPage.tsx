import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PackageSearch } from 'lucide-react';
import { listOrders } from '../api/orders';
import { formatPrice } from '../utils/format';
import OrderStatusBadge from '../components/OrderStatusBadge';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';

export default function OrdersPage() {
  const { data, isLoading } = useQuery({ queryKey: ['orders'], queryFn: () => listOrders() });

  if (isLoading) return <Loader />;

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={<PackageSearch size={26} strokeWidth={1.5} />}
        title="No orders yet"
        description="Your placed orders will show up here."
        action={
          <Link to="/products" className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
            Start Shopping
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4">My Orders</h1>
      <div className="flex flex-col gap-3">
        {data.items.map((order) => {
          const store = typeof order.store === 'object' ? order.store : null;
          return (
            <Link
              key={order._id}
              to={`/orders/${order._id}`}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow"
            >
              <div>
                <p className="font-semibold text-gray-900">{order.orderNumber}</p>
                <p className="text-xs text-gray-500 mt-0.5">{store?.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{new Date(order.createdAt).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-900">{formatPrice(order.grandTotal)}</p>
                <div className="mt-1">
                  <OrderStatusBadge status={order.orderStatus} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
