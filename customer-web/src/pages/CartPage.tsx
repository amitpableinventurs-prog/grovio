import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import * as cartApi from '../api/cart';
import { resolveAssetUrl, apiErrorMessage } from '../api/client';
import { useCart, CART_QUERY_KEY } from '../hooks/useCart';
import PriceTag from '../components/PriceTag';
import { formatPrice } from '../utils/format';
import QuantityStepper from '../components/QuantityStepper';
import Loader from '../components/Loader';
import EmptyState from '../components/EmptyState';

export default function CartPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { cart, isLoading, updateItem, removeItem } = useCart();
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);

  const applyCouponMutation = useMutation({
    mutationFn: cartApi.applyCoupon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
      setCouponError(null);
    },
    onError: (err) => setCouponError(apiErrorMessage(err, 'Invalid coupon')),
  });

  const removeCouponMutation = useMutation({
    mutationFn: cartApi.removeCoupon,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY }),
  });

  if (isLoading) return <Loader />;

  if (!cart || cart.items.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingCart size={26} strokeWidth={1.5} />}
        title="Your cart is empty"
        description="Looks like you haven't added anything yet."
        action={
          <Link to="/products" className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
            Start Shopping
          </Link>
        }
      />
    );
  }

  // Checkout splits a cart into one order per store (each with its own delivery charge) — see
  // backend/src/controllers/customer/orders.controller.js#loadAndPriceCart — so group the items
  // here the same way to preview that split before the customer pays.
  const deliveryFeePerStore = 25;
  const groups = new Map<string, { storeName: string; items: typeof cart.items }>();
  for (const item of cart.items) {
    const store = typeof item.product.store === 'object' ? item.product.store : null;
    const storeId = store?._id ?? (typeof item.product.store === 'string' ? item.product.store : 'unknown');
    if (!groups.has(storeId)) groups.set(storeId, { storeName: store?.name ?? 'Store', items: [] });
    groups.get(storeId)!.items.push(item);
  }
  const storeCount = groups.size;
  const deliveryFee = deliveryFeePerStore * storeCount;
  const total = cart.subtotal + deliveryFee;

  return (
    <div className="grid gap-8 md:grid-cols-3">
      <div className="md:col-span-2 flex flex-col gap-5">
        <h1 className="text-xl font-bold text-gray-900">My Cart</h1>
        {[...groups.entries()].map(([storeId, group]) => (
          <div key={storeId} className="flex flex-col gap-3">
            {storeCount > 1 && <h2 className="text-sm font-semibold text-gray-700">{group.storeName}</h2>}
            {group.items.map((item) => {
              const image = resolveAssetUrl(item.product.images?.[0]);
              return (
                <div key={item._id} className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-50">
                    {image ? (
                      <img src={image} alt={item.product.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-gray-300">
                        <ShoppingCart size={22} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{item.product.name}</p>
                    <p className="text-xs text-gray-500">{item.product.unit}</p>
                    <div className="mt-1">
                      <PriceTag price={item.priceSnapshot} />
                    </div>
                  </div>
                  <QuantityStepper
                    qty={item.qty}
                    onChange={(qty) => (qty <= 0 ? removeItem(item._id) : updateItem({ itemId: item._id, qty }))}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 h-fit">
        <h2 className="font-semibold text-gray-900 mb-4">Bill Details</h2>

        <div className="mb-4">
          {cart.couponCode ? (
            <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2">
              <span className="text-sm font-medium text-brand-700">Coupon "{cart.couponCode}" applied</span>
              <button onClick={() => removeCouponMutation.mutate()} className="text-xs font-semibold text-red-500">
                Remove
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (couponInput.trim()) applyCouponMutation.mutate(couponInput.trim());
              }}
              className="flex gap-2"
            >
              <input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                placeholder="Coupon code"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <button
                type="submit"
                disabled={applyCouponMutation.isPending}
                className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                Apply
              </button>
            </form>
          )}
          {couponError && <p className="mt-1 text-xs text-red-600">{couponError}</p>}
        </div>

        {storeCount > 1 && (
          <p className="mb-3 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            Items from {storeCount} stores will be placed as one order, with a delivery charge per store.
          </p>
        )}

        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>Item Total</span>
            <span>{formatPrice(cart.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Delivery Charge{storeCount > 1 ? ` (${storeCount} stores)` : ''}</span>
            <span>{formatPrice(deliveryFee)}</span>
          </div>
        </div>
        <div className="mt-3 flex justify-between border-t border-gray-200 pt-3 font-bold text-gray-900">
          <span>Total Payable</span>
          <span>{formatPrice(total)}</span>
        </div>

        <button
          onClick={() => navigate('/checkout')}
          className="mt-5 w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Proceed to Checkout
        </button>
      </div>
    </div>
  );
}
