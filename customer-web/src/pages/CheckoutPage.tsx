import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as addressApi from '../api/addresses';
import * as ordersApi from '../api/orders';
import { apiErrorMessage } from '../api/client';
import { CART_QUERY_KEY } from '../hooks/useCart';
import { formatPrice } from '../utils/format';
import AddressForm from '../components/AddressForm';
import Loader from '../components/Loader';

type PaymentMethod = 'COD' | 'WALLET';

export default function CheckoutPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('COD');
  const [error, setError] = useState<string | null>(null);

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

  const placeOrderMutation = useMutation({
    mutationFn: () => ordersApi.placeOrder(activeAddressId as string, paymentMethod),
    onSuccess: (order) => {
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
            <div className="flex justify-between">
              <span>Item Total</span>
              <span>{formatPrice(summary.itemTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Delivery Charge</span>
              <span>{formatPrice(summary.deliveryFee)}</span>
            </div>
            {summary.discount > 0 && (
              <div className="flex justify-between text-brand-700">
                <span>Discount</span>
                <span>-{formatPrice(summary.discount)}</span>
              </div>
            )}
            <div className="mt-3 flex justify-between border-t border-gray-200 pt-3 font-bold text-gray-900">
              <span>Total Payable</span>
              <span>{formatPrice(summary.grandTotal)}</span>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          onClick={() => placeOrderMutation.mutate()}
          disabled={!activeAddressId || placeOrderMutation.isPending}
          className="mt-5 w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {placeOrderMutation.isPending ? 'Placing Order...' : `Pay ${summary ? formatPrice(summary.grandTotal) : ''}`}
        </button>
      </div>
    </div>
  );
}
