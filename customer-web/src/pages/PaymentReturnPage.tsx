import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import * as ordersApi from '../api/orders';
import * as paymentsApi from '../api/payments';
import { apiErrorMessage } from '../api/client';
import { CART_QUERY_KEY } from '../hooks/useCart';
import { redirectToGateway } from '../utils/gatewayRedirect';
import Loader from '../components/Loader';

type Outcome = 'checking' | 'paid' | 'pending' | 'failed';

// Where PayU and PhonePe send the customer back after paying: /payment/return?gateway=&orderId=.
// The redirect itself proves nothing — PhonePe's result is re-checked with PhonePe here, and
// PayU's was already verified by the backend (its callback) before redirecting, so the order's
// own paymentStatus is what decides the message.
export default function PaymentReturnPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orderId = params.get('orderId') || '';
  const gateway = params.get('gateway');
  const [outcome, setOutcome] = useState<Outcome>('checking');
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const { data: order, refetch } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => ordersApi.getOrder(orderId),
    enabled: !!orderId,
  });

  const check = async () => {
    setOutcome('checking');
    setError(null);
    try {
      const status = gateway === 'phonepe'
        ? (await paymentsApi.verifyPhonepePayment(orderId)).order.paymentStatus
        : (await refetch()).data?.paymentStatus;
      setOutcome(status === 'paid' ? 'paid' : status === 'failed' ? 'failed' : 'pending');
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
    } catch (err) {
      setOutcome('pending');
      setError(apiErrorMessage(err, 'Could not confirm the payment yet.'));
    }
  };

  useEffect(() => {
    if (orderId) check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, gateway]);

  // Paid: continue to the usual confirmation screen.
  useEffect(() => {
    if (outcome === 'paid') {
      const t = setTimeout(() => navigate(`/order-placed/${orderId}`, { replace: true }), 1200);
      return () => clearTimeout(t);
    }
  }, [outcome, orderId, navigate]);

  const retry = async () => {
    if (!order || (order.paymentMethod !== 'PAYU' && order.paymentMethod !== 'PHONEPE')) return;
    setRetrying(true);
    try {
      await redirectToGateway(order.paymentMethod, orderId);
    } catch (err) {
      setRetrying(false);
      setError(apiErrorMessage(err, 'Could not open the payment page'));
    }
  };

  if (!orderId) return <p className="py-20 text-center text-gray-500">Missing order.</p>;
  if (outcome === 'checking') return <Loader />;

  const view = {
    paid: { icon: <CheckCircle2 className="h-12 w-12 text-brand-600" />, title: 'Payment successful', text: 'Taking you to your order…' },
    pending: { icon: <Clock className="h-12 w-12 text-amber-500" />, title: 'Confirming your payment', text: 'If money left your account it will show here in a minute. You will not be charged twice.' },
    failed: { icon: <XCircle className="h-12 w-12 text-red-500" />, title: 'Payment failed', text: 'No money was taken. You can try again — your order is saved.' },
  }[outcome];

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white p-8 text-center">
      {view.icon}
      <h1 className="text-xl font-bold text-gray-900">{view.title}</h1>
      <p className="text-sm text-gray-600">{view.text}</p>
      {order && <p className="text-xs text-gray-400">Order {order.orderNumber}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex w-full flex-col gap-2">
        {outcome === 'pending' && (
          <button onClick={check} className="rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
            Check again
          </button>
        )}
        {outcome === 'failed' && (
          <button onClick={retry} disabled={retrying} className="rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
            {retrying ? 'Opening payment page…' : 'Try payment again'}
          </button>
        )}
        <Link to={`/orders/${orderId}`} className="rounded-lg border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          View order
        </Link>
      </div>
    </div>
  );
}
