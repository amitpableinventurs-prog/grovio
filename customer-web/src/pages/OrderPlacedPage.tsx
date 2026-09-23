import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { getOrder } from '../api/orders';
import { formatPrice } from '../utils/format';
import Loader from '../components/Loader';

export default function OrderPlacedPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: () => getOrder(id as string),
    enabled: !!id,
  });

  if (isLoading) return <Loader />;
  if (!order) return null;

  return (
    <div className="mx-auto max-w-md text-center py-10">
      <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-brand-100 text-brand-600">
        <CheckCircle2 size={40} />
      </div>
      <h1 className="text-2xl font-bold text-gray-900">Order Placed Successfully!</h1>
      <p className="mt-2 text-sm text-gray-500">
        {order.orderStatus === 'placed'
          ? "We've received your order. The store will confirm it shortly — track it from My Orders."
          : "We've received your order and will start preparing it soon."}
      </p>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 text-left">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Order ID</span>
          <span className="font-semibold text-gray-900">{order.orderNumber}</span>
        </div>
        <div className="flex justify-between text-sm mt-2">
          <span className="text-gray-500">Total Payable</span>
          <span className="font-semibold text-gray-900">{formatPrice(order.grandTotal)}</span>
        </div>
        <div className="flex justify-between text-sm mt-2">
          <span className="text-gray-500">Payment Method</span>
          <span className="font-semibold text-gray-900">{order.paymentMethod}</span>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Link to={`/orders/${order._id}`} className="rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700">
          View Order Details
        </Link>
        <Link to="/products" className="rounded-lg border border-gray-300 py-3 text-sm font-semibold text-gray-700">
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}
