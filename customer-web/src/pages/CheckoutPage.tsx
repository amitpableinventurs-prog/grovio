import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as addressApi from '../api/addresses';
import * as ordersApi from '../api/orders';
import * as paymentsApi from '../api/payments';
import { apiErrorMessage } from '../api/client';
import { CART_QUERY_KEY } from '../hooks/useCart';
import { formatPrice } from '../utils/format';
import BillBreakdown from '../components/BillBreakdown';
import { loadRazorpayScript, openRazorpayCheckout } from '../utils/razorpay';
import { useAuthStore } from '../store/authStore';
import AddressForm from '../components/AddressForm';
import Loader from '../components/Loader';
import type { Order } from '../types';

type PaymentMethod = 'COD' | 'WALLET' | 'RAZORPAY';

export default function CheckoutPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('COD');
  const [error, setError] = useState<string | null>(null);
  const [payingViaGateway, setPayingViaGateway] = useState(false);

  const { data: addresses, isLoading: addressesLoading } = useQuery({
    queryKey: ['addresses'],
    queryFn: addressApi.listAddresses,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['checkout-summary'],
    queryFn: () => ordersApi.checkoutSummary(),
  });

  const activeAddressId = selectedAddressId || addresses?.find((a) => a.isDefault)?._id || addresses?.[0]?._id || null;

  const createAddressMutation = useMutation({
    mutationFn: addressApi.createAddress,
    onSuccess: (address) => {
      queryClient.invalidateQueries({ queryKey: ['addresses'] });
      setSelectedAddressId(address._id);
      setShowAddressForm(false);
    },
  });

  // Runs after an order is placed with paymentMethod: 'RAZORPAY'. The order already exists
  // (paymentStatus 'pending') at this point — a dismissed/failed attempt here just reports the
  // failure and leaves the customer on this page; it does not create a duplicate order.
  const startRazorpayCheckout = async (order: Order) => {
    setPayingViaGateway(true);
    setError(null);
    try {
      await loadRazorpayScript();
      const rzpOrder = await paymentsApi.createRazorpayOrder(order._id);
      const user = useAuthStore.getState().user;

      openRazorpayCheckout({
        key: rzpOrder.keyId,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        order_id: rzpOrder.razorpayOrderId,
        name: 'Grovio',
        description: `Order ${order.orderNumber}`,
        prefill: { name: user?.name, email: user?.email ?? undefined, contact: user?.phone ?? undefined },
        theme: { color: '#16a34a' },
        handler: async (response) => {
          try {
            await paymentsApi.verifyRazorpayPayment({
              orderId: order._id,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
            navigate(`/order-placed/${order._id}`);
          } catch (err) {
            setError(apiErrorMessage(err, 'Payment could not be verified. Check "My Orders" for this order\'s status.'));
          } finally {
            setPayingViaGateway(false);
          }
        },
        modal: {
          ondismiss: async () => {
            setPayingViaGateway(false);
            setError('Payment was cancelled. You can try again or choose a different payment method.');
            await paymentsApi.reportRazorpayFailure({
              orderId: order._id,
              razorpayOrderId: rzpOrder.razorpayOrderId,
              reason: 'Payment cancelled by user',
            });
          },
        },
      });
    } catch (err) {
      setPayingViaGateway(false);
      setError(apiErrorMessage(err, 'Could not start the payment gateway'));
    }
  };

  const placeOrderMutation = useMutation({
    mutationFn: () => ordersApi.placeOrder(activeAddressId as string, paymentMethod),
    onSuccess: async (order) => {
      if (paymentMethod === 'RAZORPAY') {
        await startRazorpayCheckout(order);
        return;
      }
      queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
      navigate(`/order-placed/${order._id}`);
    },
    onError: (err) => setError(apiErrorMessage(err, 'Could not place order')),
  });

  if (addressesLoading || summaryLoading) return <Loader />;

  return (
    <div className="grid gap-8 md:grid-cols-3">
      <div className="md:col-span-2 flex flex-col gap-6">
        <h1 className="text-xl font-bold text-gray-900">Checkout</h1>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Delivery Address</h2>
            <button onClick={() => setShowAddressForm((v) => !v)} className="text-sm font-medium text-brand-700 hover:underline">
              {showAddressForm ? 'Cancel' : '+ Add New'}
            </button>
          </div>

          {showAddressForm && (
            <div className="mb-4 border-b border-gray-100 pb-4">
              <AddressForm onSubmit={(payload) => createAddressMutation.mutate(payload)} isSubmitting={createAddressMutation.isPending} />
            </div>
          )}

          {!addresses || addresses.length === 0 ? (
            !showAddressForm && <p className="text-sm text-gray-500">No saved addresses. Add one to continue.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {addresses.map((address) => (
                <label
                  key={address._id}
                  className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${
                    activeAddressId === address._id ? 'border-brand-600 bg-brand-50' : 'border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="address"
                    checked={activeAddressId === address._id}
                    onChange={() => setSelectedAddressId(address._id)}
                    className="mt-1"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{address.label}</p>
                    <p className="text-sm text-gray-600">
                      {[address.line1, address.landmark, address.city, address.state, address.pincode].filter(Boolean).join(', ')}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="font-semibold text-gray-900 mb-3">Payment Method</h2>
          <div className="flex flex-col gap-2">
            {([
              { value: 'COD', label: 'Cash on Delivery', hint: 'Pay when you receive your order' },
              { value: 'WALLET', label: 'Wallet', hint: 'Pay using your Grovio wallet balance' },
              { value: 'RAZORPAY', label: 'UPI / Card / Netbanking', hint: 'Pay online via UPI, debit/credit card or netbanking' },
            ] as const).map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer ${
                  paymentMethod === opt.value ? 'border-brand-600 bg-brand-50' : 'border-gray-200'
                }`}
              >
                <input type="radio" name="payment" checked={paymentMethod === opt.value} onChange={() => setPaymentMethod(opt.value)} />
                <div>
                  <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 h-fit">
        <h2 className="font-semibold text-gray-900 mb-4">Bill Details</h2>
        {summary && (
          <div className="space-y-2 text-sm text-gray-600">
            {summary.stores.length > 1 && (
              <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Items are from {summary.stores.length} stores — delivered together as one order.
              </div>
            )}
            {summary.freeDeliveryAbove !== null && !summary.freeDeliveryApplied && (
              <div className="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
                Add {formatPrice(summary.freeDeliveryAbove - summary.itemTotal)} more for free delivery
              </div>
            )}
            <BillBreakdown bill={summary} />
            <div className="mt-3 flex justify-between border-t border-gray-200 pt-3 font-bold text-gray-900">
              <span>Total Payable</span>
              <span>{formatPrice(summary.grandTotal)}</span>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {!activeAddressId && !error && (
          <p className="mt-3 text-sm text-amber-700">Add a delivery address above to continue.</p>
        )}

        <button
          onClick={() => placeOrderMutation.mutate()}
          disabled={!activeAddressId || placeOrderMutation.isPending || payingViaGateway}
          className="mt-5 w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {payingViaGateway
            ? 'Waiting for payment...'
            : placeOrderMutation.isPending
              ? 'Placing Order...'
              : `Pay ${summary ? formatPrice(summary.grandTotal) : ''}`}
        </button>
      </div>
    </div>
  );
}
