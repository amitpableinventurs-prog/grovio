import type { OrderStatus } from '../types';

const LABELS: Record<OrderStatus, string> = {
  placed: 'Awaiting confirmation',
  accepted: 'Accepted',
  rejected: 'Rejected',
  picking: 'Picking',
  packed: 'Packed',
  assigned: 'Assigned',
  picked_up: 'Picked Up',
  out_for_delivery: 'Out for Delivery',
  delivery_failed: 'Delivery Failed',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

const COLORS: Record<OrderStatus, string> = {
  placed: 'bg-blue-50 text-blue-600',
  accepted: 'bg-blue-50 text-blue-600',
  rejected: 'bg-red-50 text-red-600',
  picking: 'bg-amber-50 text-amber-600',
  packed: 'bg-amber-50 text-amber-600',
  assigned: 'bg-amber-50 text-amber-600',
  picked_up: 'bg-amber-50 text-amber-600',
  out_for_delivery: 'bg-amber-50 text-amber-600',
  delivery_failed: 'bg-red-50 text-red-600',
  delivered: 'bg-brand-50 text-brand-700',
  cancelled: 'bg-red-50 text-red-600',
  returned: 'bg-gray-100 text-gray-600',
};

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${COLORS[status]}`}>{LABELS[status]}</span>
  );
}
